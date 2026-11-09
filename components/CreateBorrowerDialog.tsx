"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface CreateBorrowerDialogProps {
  trigger?: React.ReactNode;
}

export default function CreateBorrowerDialog({
  trigger,
}: CreateBorrowerDialogProps = {}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const handleCreate = async () => {
    const cleanName = name.trim();
    if (!cleanName) {
      toast.error("Borrower name is required.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/borrowers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: cleanName }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "Failed to add borrower");
      }

      toast.success("Borrower added successfully.");
      setName("");
      setOpen(false);
      router.refresh();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        setOpen(val);
        if (!val) setName("");
      }}
    >
      <DialogTrigger asChild>
        {trigger ? (
          trigger
        ) : (
          <Button>
            <Plus className="mr-2 h-4 w-4" /> Add borrower
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add borrower</DialogTitle>
          <DialogDescription>
            Enter the name of the new borrower to start tracking items lent to
            them.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy && name.trim()) {
              handleCreate();
            }
          }}
          className="space-y-4 py-2"
        >
          <div className="space-y-2">
            <Label htmlFor="borrower-name">Name</Label>
            <Input
              id="borrower-name"
              placeholder="e.g. Yacine"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              disabled={busy}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? "Adding..." : "Add borrower"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
