import Link from "next/link";
import { db } from "@/lib/db";
import { borrower } from "@/lib/schema";
import { asc } from "drizzle-orm";
import BorrowerActions from "@/components/borrowerActions";
import AdminPage from "@/components/admin/AdminPage";
import CreateBorrowerDialog from "@/components/CreateBorrowerDialog";

export default async function BorrowersPage() {
  const borrowers = await db
    .select({
      id: borrower.id,
      name: borrower.name,
    })
    .from(borrower)
    .orderBy(asc(borrower.name));

  return (
    <AdminPage
      title="Borrowers"
      description="Select a borrower to view their lended inventory."
      width="narrow"
      actions={<CreateBorrowerDialog />}
    >
      {borrowers.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-md border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">No borrowers found yet.</p>
          <div className="mt-4">
            <CreateBorrowerDialog />
          </div>
        </div>
      ) : (
        <div className="grid gap-3">
          {borrowers.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between rounded-md border p-2 pl-4 text-sm transition hover:bg-accent/50"
            >
              <Link href={`/admin/borrowers/${item.id}`} className="flex-1 py-2">
                <span className="font-medium">{item.name}</span>
              </Link>
              <BorrowerActions borrowerId={item.id} name={item.name} />
            </div>
          ))}
        </div>
      )}
    </AdminPage>
  );
}
