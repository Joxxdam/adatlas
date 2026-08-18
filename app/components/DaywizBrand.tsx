export function DaywizBrand({
  className = "",
  subtitle,
}: {
  className?: string;
  subtitle?: string;
}) {
  return (
    <span className={`daywiz-logo-lockup ${className}`.trim()}>
      <img alt="DAYWIZ" src="/daywiz-logo.svg?v=3" />
      {subtitle ? <small>{subtitle}</small> : null}
    </span>
  );
}
