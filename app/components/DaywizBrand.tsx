import Image from "next/image";

export function DaywizBrand({ className = "", subtitle }: { className?: string; subtitle?: string }) {
  return (
    <span className={`daywiz-logo-lockup ${className}`.trim()}>
      <Image alt="DAYWIZ" height={401} priority src="/daywiz-logo.png" width={1000} />
      {subtitle ? <small>{subtitle}</small> : null}
    </span>
  );
}
