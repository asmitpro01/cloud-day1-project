import Image from "next/image";
import Link from "next/link";
import { site } from "@/config/site";
import { cn } from "@/lib/utils";

export function Logo({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={cn("flex items-center gap-2 font-semibold tracking-tight", className)}>
      <Image src={site.brand.logoPath} alt="" width={28} height={28} priority />
      <span>{site.brand.name}</span>
    </Link>
  );
}
