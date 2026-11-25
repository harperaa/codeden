import { HARDEN_PRODUCT_NAME, hardenWordmark } from "@codeden/contracts";

/**
 * The product's name as a brand: `Code` in the text colour, `Harden` in the brand red (the
 * split, and what a product with another name gets, is `hardenWordmark`). Used wherever the
 * name stands as the brand; ordinary sentences keep plain text.
 */
export function Wordmark({ className }: { className?: string }) {
  const { lead, accent } = hardenWordmark();
  return (
    <span className={className} data-testid="wordmark">
      {lead}
      {accent ? <span className="text-brand-text">{accent}</span> : null}
    </span>
  );
}

/** A line that starts with the product name (the version line): the name as the wordmark. */
export function WordmarkLine({ text }: { text: string }) {
  if (!text.startsWith(HARDEN_PRODUCT_NAME)) return <>{text}</>;
  return (
    <>
      <Wordmark />
      {text.slice(HARDEN_PRODUCT_NAME.length)}
    </>
  );
}
