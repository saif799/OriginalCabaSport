import AddShoeForm from "@/components/AddShoeForm";
import AdminPage from "@/components/admin/AdminPage";

export default function AddShoesPage() {
  return (
    <AdminPage
      title="Add Shoes"
      description="Receive an arrivage: pick a model and colour, enter the pairs per size."
    >
      <AddShoeForm />
    </AdminPage>
  );
}
