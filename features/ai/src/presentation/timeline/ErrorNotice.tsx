/**
 * A run that ended badly says so in the feed, in place, where the work stopped.
 */
export function ErrorNotice({ message }: { readonly message: string }) {
  return (
    <p className="timeline-error" role="alert">
      {message}
    </p>
  )
}
