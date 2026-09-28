import Link from "next/link";

import { ProductBrand } from "@/shared/ui/brand-mark";
import { buttonStyles } from "@/shared/ui/button";

const navigation = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#employees", label: "For employees" },
  { href: "/#employers", label: "For employers" },
  { href: "/#faq", label: "FAQ" },
] as const;

export function LandingHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl">
      <div className="mx-auto flex h-18 max-w-7xl items-center justify-between gap-6 px-4 sm:px-6 lg:px-8">
        <ProductBrand />
        <nav
          aria-label="Main navigation"
          className="hidden items-center gap-7 md:flex"
        >
          {navigation.map((item) => (
            <Link
              key={item.href}
              className="text-sm font-medium text-slate-600 transition-colors hover:text-slate-950 focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-600"
              href={item.href}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <Link
          className={buttonStyles({ size: "sm", variant: "outline" })}
          href="/sign-in"
        >
          Sign in
        </Link>
      </div>
    </header>
  );
}
