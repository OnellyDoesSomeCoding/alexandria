import Form from "next/form";
import { MAX_QUERY_LENGTH, MIN_QUERY_LENGTH } from "@/lib/sources";
import { Button, inputClass } from "@/components/ui";

/** Plain GET form: submitting navigates to /search?q=..., so results are shareable and Back works. */
export function SearchForm({ defaultValue = "" }: { defaultValue?: string }) {
  return (
    <Form action="/search" className="flex flex-col gap-2 sm:flex-row">
      <input
        name="q"
        type="search"
        required
        minLength={MIN_QUERY_LENGTH}
        maxLength={MAX_QUERY_LENGTH}
        defaultValue={defaultValue}
        placeholder="Search by title…"
        aria-label="Search by title"
        className={`${inputClass} sm:flex-1`}
      />
      <Button type="submit">Search</Button>
    </Form>
  );
}
