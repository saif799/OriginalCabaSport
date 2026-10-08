import { cn } from "@/lib/utils";

/**
 * The one page shell for /admin/*.
 *
 * Before this existed the ten dashboard pages carried four different container
 * conventions between them (`container mx-auto py-5`, `max-w-2xl my-6`,
 * `max-w-3xl px-4 py-8`, `max-w-6xl p-4 md:p-8`), so headings, gutters and
 * measure drifted page to page. Those collapse into three deliberate widths:
 *
 *   narrow   forms and short lists — borrowers, rebalance
 *   default  everything else
 *   wide     full-bleed grids and data tables — home, orders, borrower detail
 *
 * Not a client component: it renders from Server Components and from the
 * "use client" pages alike.
 */
export type AdminPageWidth = "narrow" | "default" | "wide";

const widthClass: Record<AdminPageWidth, string> = {
  narrow: "max-w-3xl",
  default: "max-w-6xl",
  wide: "max-w-none",
};

export function AdminPage({
  title,
  description,
  actions,
  width = "default",
  className,
  children,
}: {
  title: string;
  /** One line under the title. Omit it rather than padding it out. */
  description?: React.ReactNode;
  /** The top-right button row, aligned with the title on wide screens. */
  actions?: React.ReactNode;
  width?: AdminPageWidth;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-4 py-6 md:px-8 md:py-8",
        widthClass[width],
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description ? (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>

      <div className="mt-6">{children}</div>
    </div>
  );
}

export default AdminPage;
