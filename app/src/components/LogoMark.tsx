import { useId } from "react";

const PRISM = "M24.4 9.6a3 3 0 0 1 5.2 0l20.3 37.3a3 3 0 0 1-2.6 4.4H6.7a3 3 0 0 1-2.6-4.4z";
const RAYS: [string, string, string][] = [
  ["#ff7f8f", "M41 31.5L61 16", "9 3.5 6 3.5 60"],
  ["#f2c14e", "M41.6 32.6L62 25", "6 3.5 10 3.5 60"],
  ["#2ed3a9", "M42 34L62.2 34", "11 3.5 5 3.5 60"],
  ["#46a8ff", "M42.2 35.4L62 43", "7 3.5 9 3.5 60"],
  ["#8b7bff", "M42 36.6L61 51.5", "10 3.5 7 3.5 60"],
];

/** The Prism mark (assets/brand/logo-mark*.svg). `glass="white"` for dark tiles, `"indigo"` works anywhere. */
export function LogoMark({ size = 22, glass = "white" }: { size?: number; glass?: "white" | "indigo" }) {
  const id = useId().replace(/:/g, "");
  const white = glass === "white";
  const beam = white ? "#fff" : "#8a8fa0";
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true" className="logo-mark">
      <defs>
        <linearGradient id={`${id}g`} x1="10" y1="8" x2="46" y2="54" gradientUnits="userSpaceOnUse">
          {white ? (
            <>
              <stop stopColor="#fff" stopOpacity=".42" />
              <stop offset=".55" stopColor="#fff" stopOpacity=".12" />
              <stop offset="1" stopColor="#fff" stopOpacity=".22" />
            </>
          ) : (
            <>
              <stop stopColor="#a9a7ff" stopOpacity=".75" />
              <stop offset=".55" stopColor="#6461f2" stopOpacity=".35" />
              <stop offset="1" stopColor="#4f4be0" stopOpacity=".55" />
            </>
          )}
        </linearGradient>
        <linearGradient id={`${id}r`} x1="8" y1="8" x2="48" y2="54" gradientUnits="userSpaceOnUse">
          {white ? (
            <>
              <stop stopColor="#fff" />
              <stop offset=".5" stopColor="#fff" stopOpacity=".45" />
              <stop offset="1" stopColor="#fff" stopOpacity=".8" />
            </>
          ) : (
            <>
              <stop stopColor="#c9c8ff" />
              <stop offset=".5" stopColor="#6461f2" />
              <stop offset="1" stopColor="#8e8cff" />
            </>
          )}
        </linearGradient>
        <linearGradient id={`${id}b`} x1="1" y1="0" x2="11" y2="0" gradientUnits="userSpaceOnUse">
          <stop stopColor={beam} stopOpacity="0" />
          <stop offset="1" stopColor={beam} />
        </linearGradient>
      </defs>
      <path d="M1.5 39.5L10.6 34.7" stroke={`url(#${id}b)`} strokeWidth="3.2" strokeLinecap="round" />
      {RAYS.map(([c, d, da]) => (
        <path key={c} d={d} stroke={c} strokeWidth="3.4" strokeLinecap="round" strokeDasharray={da} />
      ))}
      <path d={PRISM} fill={`url(#${id}g)`} stroke={`url(#${id}r)`} strokeWidth="2" />
      <path d="M11.5 34.6L41.2 33.8" stroke="#fff" strokeOpacity={white ? 0.55 : 0.7} strokeWidth="2" strokeLinecap="round" />
      <path d="M22.6 14.2L9.4 38.6" stroke="#fff" strokeOpacity={white ? 0.7 : 0.85} strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/** Mark on the dark rounded brand tile (reads the same in both themes). */
export function BrandTile({ size = 28 }: { size?: number }) {
  return (
    <span className="brand-tile" style={{ width: size, height: size, borderRadius: size * 0.29 }}>
      <LogoMark size={Math.round(size * 0.78)} />
    </span>
  );
}
