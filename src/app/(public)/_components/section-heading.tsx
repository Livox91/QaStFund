import { cn } from "@/shared/utils/class-names";

export function SectionHeading({
  align = "left",
  description,
  eyebrow,
  title,
}: {
  align?: "left" | "center";
  description: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <div
      className={cn("max-w-2xl", align === "center" && "mx-auto text-center")}
    >
      <p className="text-sm font-semibold tracking-wide text-teal-700 uppercase">
        {eyebrow}
      </p>
      <h2 className="mt-3 text-3xl font-semibold tracking-[-0.025em] text-slate-950 sm:text-4xl">
        {title}
      </h2>
      <p className="mt-4 text-base leading-7 text-slate-600 sm:text-lg">
        {description}
      </p>
    </div>
  );
}
