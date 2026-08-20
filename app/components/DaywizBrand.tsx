import Image from "next/image";

export function DaywizBrand({
  className = "",
  subtitle,
}: {
  className?: string;
  subtitle?: string;
}) {
  return (
    <span className={`daywiz-logo-lockup ${className}`.trim()}>
      <Image alt="DAYWIZ" height={64} priority src="/daywiz-logo.svg" width={228} />
      {subtitle ? <small>{subtitle}</small> : null}
    </span>
  );
}
