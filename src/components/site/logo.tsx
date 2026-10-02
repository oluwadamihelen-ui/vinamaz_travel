import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Vinamaz Travels logo. The artwork is crimson + gold, so on dark surfaces (`dark`) it sits on a
 * white plate to keep full brand colours and contrast.
 */
export function Logo({ className, dark = false, href = "/" }: { className?: string; dark?: boolean; href?: string }) {
  return (
    <Link href={href} className={cn("inline-flex w-fit items-center", dark && "rounded-xl bg-white px-3 py-1.5", className)} aria-label="Vinamaz Travels home">
      <Image src="/brand/logo-sm.png" alt="Vinamaz Travels" width={379} height={120} priority className="h-10 w-auto sm:h-12" />
    </Link>
  );
}
