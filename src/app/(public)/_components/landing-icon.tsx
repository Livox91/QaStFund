export type LandingIconName =
  | "arrow"
  | "building"
  | "check"
  | "coins"
  | "document"
  | "eye"
  | "people"
  | "shield"
  | "spark"
  | "wallet";

export function LandingIcon({
  className = "size-5",
  name,
}: {
  className?: string;
  name: LandingIconName;
}) {
  const paths: Record<LandingIconName, React.ReactNode> = {
    arrow: <path d="m9 5 7 7-7 7M4 12h12" />,
    building: (
      <>
        <path d="M4 21h16M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16" />
        <path d="M9 7h1m4 0h1M9 11h1m4 0h1M9 15h1m4 0h1M10 21v-3h4v3" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    coins: (
      <>
        <ellipse cx="12" cy="6" rx="7" ry="3" />
        <path d="M5 6v4c0 1.66 3.13 3 7 3s7-1.34 7-3V6M5 10v4c0 1.66 3.13 3 7 3s7-1.34 7-3v-4M5 14v4c0 1.66 3.13 3 7 3s7-1.34 7-3v-4" />
      </>
    ),
    document: (
      <>
        <path d="M7 3h7l4 4v14H7z" />
        <path d="M14 3v5h5M10 12h5m-5 4h5" />
      </>
    ),
    eye: (
      <>
        <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
        <circle cx="12" cy="12" r="2.5" />
      </>
    ),
    people: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 20a5.5 5.5 0 0 1 11 0M16 5.5a3 3 0 0 1 0 5.8M17 14.5a5.5 5.5 0 0 1 3.5 5.5" />
      </>
    ),
    shield: (
      <>
        <path d="M12 3 5 6v5c0 4.9 3 8.4 7 10 4-1.6 7-5.1 7-10V6l-7-3Z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
    spark: (
      <path d="m12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3Zm6 12 .7 2.3L21 18l-2.3.7L18 21l-.7-2.3L15 18l2.3-.7L18 15Z" />
    ),
    wallet: (
      <>
        <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H18v16H6.5A2.5 2.5 0 0 1 4 17.5v-11Z" />
        <path d="M15 10h5v5h-5a2.5 2.5 0 0 1 0-5Z" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
    >
      {paths[name]}
    </svg>
  );
}
