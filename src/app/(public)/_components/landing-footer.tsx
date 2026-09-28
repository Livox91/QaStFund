import Link from "next/link";

import { ProductBrand } from "@/shared/ui/brand-mark";

const footerLinks = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#employees", label: "Employees" },
  { href: "/#employers", label: "Employers" },
  { href: "/#trust", label: "Trust" },
  { href: "/#faq", label: "FAQ" },
] as const;

export function LandingFooter() {
  return (
    <footer className="border-t border-slate-200 bg-slate-50">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-col justify-between gap-8 sm:flex-row sm:items-center">
          <div>
            <ProductBrand />
            <p className="mt-3 max-w-sm text-sm leading-6 text-slate-500">
              A workplace-based marketplace for transparent employee lending and
              borrowing.
            </p>
          </div>
          <nav
            aria-label="Footer navigation"
            className="flex flex-wrap gap-x-6 gap-y-3"
          >
            {footerLinks.map((link) => (
              <Link
                key={link.href}
                className="text-sm font-medium text-slate-500 hover:text-slate-950"
                href={link.href}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="mt-8 flex flex-col justify-between gap-3 border-t border-slate-200 pt-6 text-xs text-slate-500 sm:flex-row">
          <p>Employee Lending Platform</p>
          <Link className="font-medium hover:text-slate-950" href="/sign-in">
            Member sign in
          </Link>
        </div>
      </div>
    </footer>
  );
}
