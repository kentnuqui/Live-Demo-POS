export function Mark({ className = '' }: { className?: string }) {
  return (
    <div className={className}>
      <div className="font-serif text-5xl leading-none tracking-tight">Towns</div>
      <div className="mt-2 text-[11px] uppercase tracking-[0.28em] text-muted-foreground">Diner</div>
    </div>
  )
}
