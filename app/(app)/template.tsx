export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <div className="animate-in fade-in-0 duration-[var(--duration-fast)]">
      {children}
    </div>
  )
}
