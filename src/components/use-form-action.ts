"use client";

import { startTransition, useActionState, type FormEvent } from "react";

/**
 * Wraps a server action for a form submitted with `onSubmit`. Unlike `<form action>`,
 * React doesn't reset the fields afterwards, so users keep their input when validation fails.
 */
export function useFormAction<T>(action: (previous: T | null, formData: FormData) => Promise<T>) {
  const [state, dispatch, pending] = useActionState<T | null, FormData>(action, null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => dispatch(formData));
  }

  return { state, pending, onSubmit };
}
