//! Queue schedule evaluation (pure time logic; the manager drives it with a ticker).
//!
//! A schedule fires on *crossings*: the manager remembers the previous tick and asks
//! whether a start or stop moment lies in `(prev, now]`. This makes it robust to
//! irregular ticks, sleep/resume (a missed start is fired once on wake-up as long as
//! it happened less than [`CATCH_UP`] ago) and never fires the same moment twice.

use crate::model::Schedule;
use chrono::{Datelike, Duration, NaiveDate, NaiveDateTime, NaiveTime};

/// Missed start moments older than this (e.g. the PC was off all day) are skipped.
pub const CATCH_UP: Duration = Duration::minutes(30);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Due {
    pub start: bool,
    pub stop: bool,
}

pub fn parse_time(s: &str) -> Option<NaiveTime> {
    NaiveTime::parse_from_str(s.trim(), "%H:%M")
        .or_else(|_| NaiveTime::parse_from_str(s.trim(), "%H:%M:%S"))
        .ok()
}

fn parse_date(s: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d").ok()
}

/// Is the schedule active on this calendar day?
pub fn runs_on(schedule: &Schedule, date: NaiveDate) -> bool {
    if let Some(once) = schedule.once_date.as_deref().and_then(parse_date) {
        return once == date;
    }
    schedule.days.is_empty()
        || schedule
            .days
            .contains(&(date.weekday().number_from_monday() as u8))
}

/// Which schedule moments happened in `(prev, now]`?
pub fn due(schedule: &Schedule, prev: NaiveDateTime, now: NaiveDateTime) -> Due {
    if !schedule.enabled || now <= prev {
        return Due::default();
    }
    let prev = prev.max(now - CATCH_UP);
    let crossed = |time: Option<NaiveTime>| -> bool {
        let Some(t) = time else { return false };
        // A window can span midnight, so check each day touched by (prev, now].
        let mut day = prev.date();
        while day <= now.date() {
            let moment = day.and_time(t);
            if moment > prev && moment <= now && runs_on(schedule, day) {
                return true;
            }
            day = day.succ_opt().unwrap_or(day);
            if day == NaiveDate::MAX {
                break;
            }
        }
        false
    };
    Due {
        start: crossed(schedule.start_time.as_deref().and_then(parse_time)),
        stop: crossed(schedule.stop_time.as_deref().and_then(parse_time)),
    }
}

/// Next start moment after `now` (for display and OS wake timers), searching two weeks.
pub fn next_start(schedule: &Schedule, now: NaiveDateTime) -> Option<NaiveDateTime> {
    if !schedule.enabled {
        return None;
    }
    let t = schedule.start_time.as_deref().and_then(parse_time)?;
    (0..15)
        .filter_map(|d| now.date().checked_add_signed(Duration::days(d)))
        .filter(|day| runs_on(schedule, *day))
        .map(|day| day.and_time(t))
        .find(|moment| *moment > now)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dt(s: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M").unwrap()
    }

    fn sched(start: &str, stop: Option<&str>, days: &[u8]) -> Schedule {
        Schedule {
            enabled: true,
            start_time: Some(start.into()),
            stop_time: stop.map(Into::into),
            days: days.to_vec(),
            ..Default::default()
        }
    }

    #[test]
    fn fires_once_on_crossing() {
        let s = sched("02:00", Some("06:00"), &[]);
        assert!(due(&s, dt("2026-10-14 01:59"), dt("2026-10-14 02:00")).start);
        assert!(!due(&s, dt("2026-10-14 02:00"), dt("2026-10-14 02:01")).start);
        assert!(due(&s, dt("2026-10-14 05:59"), dt("2026-10-14 06:00")).stop);
    }

    #[test]
    fn respects_weekdays_and_midnight() {
        // 2026-10-14 is a Wednesday (3).
        let s = sched("00:00", None, &[4]);
        assert!(!due(&s, dt("2026-10-13 23:59"), dt("2026-10-14 00:01")).start);
        assert!(due(&s, dt("2026-10-14 23:59"), dt("2026-10-15 00:01")).start);
    }

    #[test]
    fn skips_old_missed_starts_but_catches_recent() {
        let s = sched("02:00", None, &[]);
        assert!(!due(&s, dt("2026-10-14 01:00"), dt("2026-10-14 03:00")).start);
        assert!(due(&s, dt("2026-10-14 01:00"), dt("2026-10-14 02:20")).start);
    }

    #[test]
    fn once_and_next_start() {
        let mut s = sched("08:30", None, &[]);
        s.once_date = Some("2026-10-20".into());
        assert_eq!(
            next_start(&s, dt("2026-10-14 09:00")),
            Some(dt("2026-10-20 08:30"))
        );
        assert!(!due(&s, dt("2026-10-14 08:00"), dt("2026-10-14 09:00")).start);
        s.once_date = None;
        assert_eq!(
            next_start(&s, dt("2026-10-14 09:00")),
            Some(dt("2026-10-15 08:30"))
        );
    }
}
