"use client";

import { useFormAction } from "@/components/use-form-action";
import { DownloadIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteAccountAction } from "../actions";

export function PrivacySection() {
  const { state, pending, onSubmit } = useFormAction(deleteAccountAction);
  const error = state && !state.ok ? (state.error.fieldErrors?.confirm?.[0] ?? state.error.message) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-medium">Download your data</p>
          <p className="text-sm text-muted-foreground">
            A JSON file with your profile, consents, billing and invoices.
          </p>
        </div>
        <Button asChild variant="outline">
          <a href="/api/account/export" download>
            <DownloadIcon /> Export data
          </a>
        </Button>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-medium">Delete account</p>
          <p className="text-sm text-muted-foreground">
            Cancels subscriptions and erases your personal data. Invoices are kept as required by GST law.
          </p>
        </div>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="destructive">
              <Trash2Icon /> Delete account
            </Button>
          </DialogTrigger>
          <DialogContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <DialogHeader>
                <DialogTitle>Delete your account?</DialogTitle>
                <DialogDescription>
                  This cancels any active subscription and permanently erases your profile. It can&apos;t be undone.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <Label htmlFor="confirm-delete">Type DELETE to confirm</Label>
                <Input id="confirm-delete" name="confirm" autoComplete="off" required />
                {error ? (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                ) : null}
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="submit" variant="destructive" disabled={pending}>
                  {pending ? "Deleting…" : "Delete permanently"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
