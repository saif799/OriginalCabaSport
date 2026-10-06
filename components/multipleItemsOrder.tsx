"use client";

import type React from "react";

import { Dispatch, SetStateAction, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useDeliveryCoverage } from "@/lib/delivery/useDeliveryCoverage";
import { SelectGroup } from "./ui/customSelect";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { GroupedProduct } from "@/app/admin/(admin)/page";
import type { OrderDraft, OrderFormFields } from "@/lib/orders/placeOrder";

import { ChevronsUpDown } from "lucide-react";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// The fields this form collects, tied to the shared OrderDraft shape so a
// field rename there fails typecheck here instead of breaking silently.
type OrderFormData = OrderFormFields;

interface ProductCardProps {
  product: GroupedProduct;
  selectedShoes?: Array<{ id: string }>;
  selectshoe: (id: string, identifier: string) => void;
}

export default function MultipleItemsOrder({
  onSuccess,
  shoes,
}: {
  onSuccess?: () => void;
  shoes: Array<GroupedProduct>;
}) {
  // Original state for shoes management
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [source, setSource] = useState("i");
  const [selectedShoes, setSelectedShoes] = useState<
    Array<{ shoe: GroupedProduct; inventoryId: string; selectedSize: string }>
  >([]);

  const AvailableSources = [
    { code: "i", value: "instagram" },
    { code: "f", value: "facebook" },
    { code: "t", value: "tiktok" },
    { code: "w", value: "whatsapp" },
    { code: "k", value: "Ignore" },
    { code: "m", value: "mossab" },
  ];

  // New order form data state with all required fields for the API
  const [formData, setFormData] = useState<OrderFormData>({
    nom_client: "",
    telephone: "",
    telephone_2: null,
    adresse: "ville",
    commune: "",
    code_wilaya: "",
    montant: "",
    remarque: null,
    type: 1,
    stop_desk: 1,
  });

  const { wilayas, communeNames, fee, hasTarif } = useDeliveryCoverage(
    "dhd",
    formData.code_wilaya,
    formData.stop_desk as 0 | 1,
  );

  const handleSubmitToApi = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);
    if (selectedShoes.length === 0) {
      setError("Please select at least one shoe");
      setLoading(false);
      return;
    }
    try {
      const produit = `${selectedShoes.length} chassures ${selectedShoes.map(
        (shoe) =>
          shoe.shoe.modelName + " " + shoe.shoe.color + " " + shoe.selectedSize,
      )} ${source}`;

      const payload: OrderDraft = {
        ...formData,
        source,
        produit,
        // This form has no delivery-company or borrower picker: always the
        // owner's stock via DHD, same as before this was made explicit.
        provider: "dhd",
        borrowerId: null,
        selectedSizeShoeId: selectedShoes.map((s) => s.inventoryId),
      };

      const res = await fetch("/api/order", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setSuccess("Order created successfully!");
        setFormData({
          nom_client: "",
          telephone: "",
          telephone_2: null,
          adresse: "",
          commune: "",
          code_wilaya: "",
          montant: "",
          remarque: null,
          type: 1,
          stop_desk: 1,
        });
        onSuccess?.();
      } else {
        const errorData = await res.json();
        console.log(errorData);

        setError("Failed to create order");
      }
    } catch (error) {
      console.error("Error submitting order to API:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog>
      <DialogTrigger className={buttonVariants({ variant: "outline" })}>
        Add an Order
      </DialogTrigger>
      <DialogContent
        className="w-full max-w-full sm:max-w-xl transition-all duration-300 max-h-[80vh] overflow-y-auto overflow-x-hidden px-2 md:p-6"
        style={{ boxSizing: "border-box" }}
      >
        <DialogHeader>
          <DialogTitle>add an Order</DialogTitle>
          <DialogDescription>enter the client info</DialogDescription>
        </DialogHeader>
        <div className="w-full">
          <form onSubmit={handleSubmitToApi} className="space-y-6">
            {error && (
              <Alert className="bg-red-900/20 border-red-700">
                <AlertCircle className="h-4 w-4 text-red-500" />
                <AlertDescription className="text-red-400">
                  {error || "failed"}
                </AlertDescription>
              </Alert>
            )}

            {success && (
              <Alert className="border-green-400">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-green-400">
                  {success}
                </AlertDescription>
              </Alert>
            )}

            {/* No Service Type picker: this form only places a Livraison.
                An Échange is started from its Original Order's row in
                /admin/orders, which links the pairs it takes back. */}
            <div className="flex gap-4">
              <div className="grow space-y-2">
                <Label htmlFor="type of delivery" className="pb-1">
                  delivery Type
                </Label>
                <Select
                  name="type of delivery"
                  value={String(formData.stop_desk)}
                  onValueChange={(value) =>
                    setFormData({
                      ...formData,
                      stop_desk: Number(value),
                      commune: "",
                    })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select order type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">a domicile</SelectItem>
                    <SelectItem value="1">bureau</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="nom_client">Client Name</Label>
              <Input
                id="nom_client"
                value={formData.nom_client}
                onChange={(e) =>
                  setFormData({ ...formData, nom_client: e.target.value })
                }
                placeholder="Enter client name"
                className="placeholder:text-slate-500"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="telephone">Phone Number</Label>
                <Input
                  id="telephone"
                  value={formData.telephone}
                  onChange={(e) =>
                    setFormData({ ...formData, telephone: e.target.value })
                  }
                  placeholder="Primary phone number"
                  className="placeholder:text-slate-500"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="telephone_2">Alternative Phone</Label>
                <Input
                  id="telephone_2"
                  value={formData.telephone_2 || ""}
                  onChange={(e) =>
                    setFormData({ ...formData, telephone_2: e.target.value })
                  }
                  placeholder="Alternative phone number"
                  className="placeholder:text-slate-500"
                />
              </div>
            </div>

            <div className="flex gap-4">
              <div className=" space-y-2 w-full">
                <label htmlFor="wilaya">wilaya</label>
                <Select
                  name="wilaya"
                  value={String(formData.code_wilaya)}
                  onValueChange={(value) => {
                    setFormData({
                      ...formData,
                      code_wilaya: String(value),
                      commune: "",
                    });
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a wilaya..." />
                  </SelectTrigger>
                  <SelectContent className="max-w-[calc(100vw-2rem)]">
                    <SelectGroup>
                      {wilayas.map((s) => (
                        <SelectItem
                          key={s.wilayaId}
                          value={String(s.wilayaId)}
                          className={
                            formData.code_wilaya === String(s.wilayaId)
                              ? "text-green-400"
                              : "text-right"
                          }
                        >
                          {s.wilayaId} - {s.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
              <div className=" space-y-2 w-full ">
                <label htmlFor="commune"> commune</label>

                <Select
                  name="commune"
                  value={formData.commune}
                  onValueChange={(value) =>
                    setFormData({
                      ...formData,
                      commune: value,
                    })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a commune..." />
                  </SelectTrigger>
                  <SelectContent className="max-w-[calc(100vw-2rem)]">
                    <SelectGroup>
                      {formData.code_wilaya &&
                        communeNames.map((name) => (
                          <SelectItem
                            key={name}
                            value={name}
                            className={
                              formData.commune === name
                                ? "text-green-400"
                                : "text-right"
                            }
                          >
                            {name}
                          </SelectItem>
                        ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="space-y-2 w-full">
                <Label htmlFor="adresse">Address</Label>
                <Input
                  id="adresse"
                  value={formData.adresse}
                  onChange={(e) =>
                    setFormData({ ...formData, adresse: e.target.value })
                  }
                  placeholder="Enter delivery address"
                  className="placeholder:text-slate-500"
                />
              </div>

              <div className="space-y-2 w-full">
                <div className="flex items-center justify-between ">
                  <Label htmlFor="montant">Amount </Label>
                  {formData.code_wilaya && hasTarif && (
                    <span className=" text-xs font-semibold text-orange-700">
                      {fee} DA
                    </span>
                  )}
                </div>
                <Input
                  id="montant"
                  value={formData.montant}
                  onChange={(e) =>
                    setFormData({ ...formData, montant: e.target.value })
                  }
                  type="number"
                  min="0"
                  placeholder="Enter order amount"
                  className="placeholder:text-slate-500"
                />
              </div>
            </div>

            <div className="flex gap-4">
              <div className="grow space-y-2 w-full">
                <Label htmlFor="type of service" className="pb-1">
                  Source
                </Label>
                <Select
                  name="type of service"
                  value={source}
                  onValueChange={(value) => {
                    setSource(value);
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select Source " />
                  </SelectTrigger>
                  <SelectContent>
                    {AvailableSources.map((source) => (
                      <SelectItem key={source.code} value={source.code}>
                        {source.value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 w-full">
                <Label htmlFor="remarque">Remarks</Label>
                <Input
                  id="remarque"
                  value={formData.remarque || ""}
                  onChange={(e) =>
                    setFormData({ ...formData, remarque: e.target.value })
                  }
                  placeholder="Additional notes or remarks"
                  className="placeholder:text-slate-500"
                />
              </div>
            </div>

            <div>
              <ChooseShoeComboBox shoes={shoes} addShoe={setSelectedShoes} />
            </div>
            <div className="">
              {selectedShoes.map((item, index) => (
                <div
                  key={item.shoe.shoeId + index + item.inventoryId}
                  className="flex items-center gap-2 py-1"
                >
                  <Input
                    disabled
                    value={item.shoe.modelName + " " + item.shoe.color}
                  />
                  <Select
                    name="type of service"
                    value={item.selectedSize}
                    onValueChange={(value) => {
                      const prev = selectedShoes;
                      const target = item.shoe.sizes.find(
                        (s) => s.size === value,
                      );

                      if (!target) return;

                      prev[index] = {
                        shoe: item.shoe,
                        inventoryId: target.inventoryId,
                        selectedSize: target.size,
                      };
                      setSelectedShoes([...prev]);
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select Source " />
                    </SelectTrigger>
                    <SelectContent>
                      {item.shoe.sizes.map((s) => (
                        <SelectItem key={s.inventoryId} value={s.size}>
                          {s.size}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSelectedShoes((prev) =>
                        prev.filter((_, i) => i !== index),
                      );
                    }}
                  >
                    <X size={16} />
                  </Button>
                </div>
              ))}
            </div>
            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700"
            >
              {loading ? "Creating Order..." : "Create Order"}
            </Button>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ChooseShoeComboBox({
  shoes,
  addShoe,
}: {
  shoes: GroupedProduct[];
  addShoe: Dispatch<
    SetStateAction<
      {
        shoe: GroupedProduct;
        inventoryId: string;
        selectedSize: string;
      }[]
    >
  >;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
        >
          Select a shoe
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) p-0"
      >
        <Command id="addShoe">
          <CommandInput placeholder="Search framework..." className="h-9" />
          <CommandList>
            <CommandEmpty>No Shoes Found.</CommandEmpty>
            <CommandGroup>
              {shoes.map((shoe) => (
                <CommandItem
                  key={shoe.shoeId}
                  value={shoe.modelName + " " + shoe.color}
                  onSelect={() => {
                    setOpen(false);
                    addShoe((prev) => [
                      ...prev,
                      {
                        shoe: shoe,
                        inventoryId: shoe.sizes[0].inventoryId,
                        selectedSize: shoe.sizes[0].size,
                      },
                    ]);
                  }}
                >
                  {shoe.modelName} - {shoe.color}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
