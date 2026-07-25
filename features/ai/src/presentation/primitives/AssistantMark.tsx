export function AssistantMark({ className }: { readonly className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M20.5 3.5 3.9 10.2c-.7.3-.7 1.3 0 1.6l6.2 2.4c.2.1.4.3.5.5l2.4 6.2c.3.7 1.3.7 1.6 0L20.5 3.5Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
      <path d="M20.5 3.5 10.6 14.2" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
    </svg>
  )
}
