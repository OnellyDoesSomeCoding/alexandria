export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-12">
      <p className="text-center text-2xl font-semibold tracking-tight">Alexandria</p>
      {children}
    </main>
  );
}
