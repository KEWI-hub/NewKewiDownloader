//! HTTP authentication: Basic (pre-emptive or after a challenge), Digest (RFC 7616 via
//! `http-auth`) and NTLM (connection-bound three-leg handshake via `ntlmclient`).

use std::sync::Mutex;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as B64;
use url::Url;

use crate::request::{AuthScheme, Credentials};

/// What to do after a `401` challenge.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ChallengeAction {
    /// Re-send the request with a (Basic/Digest) `Authorization` header.
    Retry,
    /// Run the NTLM handshake on this connection.
    Ntlm,
    /// No usable credentials/scheme.
    GiveUp,
}

/// Per-download authentication state (shared by all workers).
pub(crate) struct AuthState {
    creds: Option<Credentials>,
    /// Challenge-derived client (Basic or Digest); Digest keeps the nonce count.
    client: Mutex<Option<http_auth::PasswordClient>>,
    ntlm: std::sync::atomic::AtomicBool,
}

impl AuthState {
    pub(crate) fn new(creds: Option<Credentials>) -> Self {
        let ntlm = creds.as_ref().is_some_and(|c| c.scheme == AuthScheme::Ntlm);
        Self {
            creds,
            client: Mutex::new(None),
            ntlm: std::sync::atomic::AtomicBool::new(ntlm),
        }
    }

    pub(crate) fn has_credentials(&self) -> bool {
        self.creds.is_some()
    }

    /// Whether requests must go through the NTLM handshake.
    pub(crate) fn uses_ntlm(&self) -> bool {
        self.ntlm.load(std::sync::atomic::Ordering::Acquire)
    }

    /// `Authorization` header for a request (Basic/Digest), if any.
    pub(crate) fn authorization(&self, method: &str, url: &Url) -> Option<String> {
        let creds = self.creds.as_ref()?;
        let mut guard = self.client.lock().expect("auth lock");
        match guard.as_mut() {
            Some(client) => {
                let uri = &url[url::Position::BeforePath..url::Position::AfterQuery];
                client
                    .respond(&http_auth::PasswordParams {
                        username: &creds.username,
                        password: &creds.password,
                        uri,
                        method,
                        body: None,
                    })
                    .ok()
            }
            None if creds.scheme == AuthScheme::Basic => {
                Some(basic(&creds.username, &creds.password))
            }
            None => None,
        }
    }

    /// Processes the `WWW-Authenticate` headers of a `401`.
    pub(crate) fn on_challenge(&self, challenges: &[String]) -> ChallengeAction {
        let Some(creds) = &self.creds else {
            return ChallengeAction::GiveUp;
        };
        let offers_ntlm = challenges
            .iter()
            .any(|c| c.trim_start().to_ascii_lowercase().starts_with("ntlm"));
        let wants_ntlm = match creds.scheme {
            AuthScheme::Ntlm => true,
            AuthScheme::Auto => {
                offers_ntlm
                    && !challenges
                        .iter()
                        .any(|c| c.trim_start().to_ascii_lowercase().starts_with("digest"))
            }
            _ => false,
        };
        if wants_ntlm && offers_ntlm {
            self.ntlm.store(true, std::sync::atomic::Ordering::Release);
            return ChallengeAction::Ntlm;
        }
        let mut builder = http_auth::PasswordClient::builder();
        for c in challenges {
            let lower = c.trim_start().to_ascii_lowercase();
            let allowed = match creds.scheme {
                AuthScheme::Auto => lower.starts_with("basic") || lower.starts_with("digest"),
                AuthScheme::Basic => lower.starts_with("basic"),
                AuthScheme::Digest => lower.starts_with("digest"),
                AuthScheme::Ntlm => false,
            };
            if allowed {
                builder = builder.challenges(c);
            }
        }
        match builder.build() {
            Ok(client) => {
                *self.client.lock().expect("auth lock") = Some(client);
                ChallengeAction::Retry
            }
            Err(_) => ChallengeAction::GiveUp,
        }
    }

    /// NTLM type-1 (negotiate) header value.
    pub(crate) fn ntlm_negotiate(&self) -> Option<String> {
        self.creds.as_ref()?;
        ntlm_negotiate_header(&workstation()).ok()
    }

    /// NTLM type-3 (authenticate) header value for a `WWW-Authenticate: NTLM <type2>` value.
    pub(crate) fn ntlm_authenticate(&self, challenge_header: &str) -> Option<String> {
        let creds = self.creds.as_ref()?;
        ntlm_authenticate_header(challenge_header, creds, &workstation()).ok()
    }
}

fn basic(user: &str, pass: &str) -> String {
    format!("Basic {}", B64.encode(format!("{user}:{pass}")))
}

fn workstation() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "PRISM".to_string())
}

/// Splits `DOMAIN\user` / `user@domain`.
fn split_domain(username: &str) -> (String, String) {
    if let Some((d, u)) = username.split_once('\\') {
        (d.to_string(), u.to_string())
    } else if let Some((u, d)) = username.split_once('@') {
        (d.to_string(), u.to_string())
    } else {
        (String::new(), username.to_string())
    }
}

pub(crate) fn ntlm_negotiate_header(workstation: &str) -> Result<String, String> {
    let flags = ntlmclient::Flags::NEGOTIATE_UNICODE
        | ntlmclient::Flags::REQUEST_TARGET
        | ntlmclient::Flags::NEGOTIATE_NTLM
        | ntlmclient::Flags::NEGOTIATE_WORKSTATION_SUPPLIED;
    let msg = ntlmclient::Message::Negotiate(ntlmclient::NegotiateMessage {
        flags,
        supplied_domain: String::new(),
        supplied_workstation: workstation.to_owned(),
        os_version: Default::default(),
    });
    let bytes = msg.to_bytes().map_err(|e| format!("{e:?}"))?;
    Ok(format!("NTLM {}", B64.encode(bytes)))
}

pub(crate) fn ntlm_authenticate_header(
    challenge_header: &str,
    creds: &Credentials,
    workstation: &str,
) -> Result<String, String> {
    let b64 = challenge_header
        .split_whitespace()
        .skip_while(|t| !t.eq_ignore_ascii_case("ntlm"))
        .nth(1)
        .ok_or("no NTLM challenge token")?;
    let raw = B64.decode(b64).map_err(|e| e.to_string())?;
    let challenge =
        match ntlmclient::Message::try_from(raw.as_slice()).map_err(|e| format!("{e:?}"))? {
            ntlmclient::Message::Challenge(c) => c,
            other => {
                return Err(format!(
                    "unexpected NTLM message {}",
                    other.message_number()
                ));
            }
        };
    let target_info: Vec<u8> = challenge
        .target_information
        .iter()
        .flat_map(|e| e.to_bytes())
        .collect();
    let (domain, username) = split_domain(&creds.username);
    let nc = ntlmclient::Credentials {
        username,
        password: creds.password.clone(),
        domain,
    };
    let response = ntlmclient::respond_challenge_ntlm_v2(
        challenge.challenge,
        &target_info,
        ntlmclient::get_ntlm_time(),
        &nc,
    );
    let msg = response.to_message(
        &nc,
        workstation,
        ntlmclient::Flags::NEGOTIATE_UNICODE | ntlmclient::Flags::NEGOTIATE_NTLM,
    );
    let bytes = msg.to_bytes().map_err(|e| format!("{e:?}"))?;
    Ok(format!("NTLM {}", B64.encode(bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn creds(scheme: AuthScheme) -> Credentials {
        Credentials {
            username: "user".into(),
            password: "pass".into(),
            scheme,
        }
    }

    #[test]
    fn basic_preemptive_and_challenge() {
        let a = AuthState::new(Some(creds(AuthScheme::Basic)));
        let url = Url::parse("http://h/x").unwrap();
        assert_eq!(a.authorization("GET", &url).unwrap(), "Basic dXNlcjpwYXNz");
        let auto = AuthState::new(Some(creds(AuthScheme::Auto)));
        assert!(auto.authorization("GET", &url).is_none());
        assert_eq!(
            auto.on_challenge(&["Basic realm=\"r\"".into()]),
            ChallengeAction::Retry
        );
        assert_eq!(
            auto.authorization("GET", &url).unwrap(),
            "Basic dXNlcjpwYXNz"
        );
        let none = AuthState::new(None);
        assert_eq!(
            none.on_challenge(&["Basic realm=\"r\"".into()]),
            ChallengeAction::GiveUp
        );
    }

    #[test]
    fn digest_response_format() {
        let a = AuthState::new(Some(creds(AuthScheme::Auto)));
        let ch = r#"Digest realm="prism", qop="auth", algorithm=MD5, nonce="abc", opaque="o""#;
        assert_eq!(a.on_challenge(&[ch.into()]), ChallengeAction::Retry);
        let url = Url::parse("http://h/file/a?x=1").unwrap();
        let h1 = a.authorization("GET", &url).unwrap();
        assert!(h1.starts_with("Digest "), "{h1}");
        assert!(h1.contains("uri=\"/file/a?x=1\""), "{h1}");
        assert!(h1.contains("nc=00000001"), "{h1}");
        let h2 = a.authorization("GET", &url).unwrap();
        assert!(h2.contains("nc=00000002"), "nonce count increments: {h2}");
        // A Digest-only credential ignores Basic challenges.
        let d = AuthState::new(Some(creds(AuthScheme::Digest)));
        assert_eq!(
            d.on_challenge(&["Basic realm=\"r\"".into()]),
            ChallengeAction::GiveUp
        );
    }

    #[test]
    fn ntlm_message_flow() {
        let a = AuthState::new(Some(Credentials {
            username: "DOM\\alice".into(),
            password: "secret".into(),
            scheme: AuthScheme::Auto,
        }));
        assert_eq!(
            a.on_challenge(&["NTLM".into(), "Basic realm=\"x\"".into()]),
            ChallengeAction::Ntlm
        );
        assert!(a.uses_ntlm());
        // Type 1.
        let neg = a.ntlm_negotiate().unwrap();
        let raw = B64.decode(neg.trim_start_matches("NTLM ")).unwrap();
        assert!(matches!(
            ntlmclient::Message::try_from(raw.as_slice()).unwrap(),
            ntlmclient::Message::Negotiate(_)
        ));
        // Server type 2.
        let challenge = ntlmclient::Message::Challenge(ntlmclient::ChallengeMessage {
            target_name: "DOM".into(),
            flags: ntlmclient::Flags::NEGOTIATE_UNICODE | ntlmclient::Flags::NEGOTIATE_NTLM,
            challenge: [1, 2, 3, 4, 5, 6, 7, 8],
            context: (0, 0),
            target_information: vec![ntlmclient::TargetInfoEntry::from_string(
                ntlmclient::TargetInfoType::NtDomain,
                "DOM",
            )],
            os_version: Default::default(),
        });
        let header = format!("NTLM {}", B64.encode(challenge.to_bytes().unwrap()));
        // Type 3.
        let auth = a.ntlm_authenticate(&header).unwrap();
        let raw = B64.decode(auth.trim_start_matches("NTLM ")).unwrap();
        match ntlmclient::Message::try_from(raw.as_slice()).unwrap() {
            ntlmclient::Message::Authenticate(m) => {
                assert_eq!(m.user_name, "alice");
                assert_eq!(m.domain_name, "DOM");
                assert!(!m.ntlm_response.is_empty());
            }
            other => panic!("unexpected {other:?}"),
        }
        assert!(a.ntlm_authenticate("NTLM !!!").is_none());
    }

    #[test]
    fn domain_split() {
        assert_eq!(split_domain("D\\u"), ("D".into(), "u".into()));
        assert_eq!(split_domain("u@d.com"), ("d.com".into(), "u".into()));
        assert_eq!(split_domain("u"), (String::new(), "u".into()));
    }
}
