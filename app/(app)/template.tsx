export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-[var(--duration-default)] ease-[var(--ease-out)]">
      {children}
    </div>
  )
}
