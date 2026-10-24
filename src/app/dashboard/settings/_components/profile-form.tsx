"use client";

import { useFormAction } from "@/components/use-form-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateProfileAction } from "../actions";
import { ActionMessage, FieldError } from "./section";

export function ProfileForm({ name }: { name: string }) {
  const { state, pending, onSubmit } = useFormAction(updateProfileAction);
  const errors = state && !state.ok ? state.error.fieldErrors : undefined;
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="profile-name">Full name</Label>
        <Input
          id="profile-name"
          name="name"
          defaultValue={name}
          autoComplete="name"
          required
          aria-describedby="profile-name-error"
        />
        <FieldError id="profile-name-error" messages={errors?.name} />
      </div>
      <ActionMessage result={state} />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
