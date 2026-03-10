import { memo } from "react";

// Deterministic star positions (no Math.random → no hydration mismatch)
const STARS = Array.from({ length: 120 }, (_, i) => ({
  cx: ((i * 137.508) % 100).toFixed(3),
  cy: ((i * 61.803) % 100).toFixed(3),
  r:  i % 5 === 0 ? 1.4 : i % 3 === 0 ? 1.0 : 0.6,
  o:  (0.15 + (i % 7) * 0.06).toFixed(2),
}));

export const Stars = memo(function Stars() {
  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
      <svg
        width="100%"
        height="100%"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        {STARS.map((s, i) => (
          <circle
            key={i}
            cx={`${s.cx}%`}
            cy={`${s.cy}%`}
            r={s.r}
            fill="white"
            opacity={s.o}
          />
        ))}
      </svg>
    </div>
  );
});
