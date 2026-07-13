import { TaeAccessActivation } from "./access-activation"

export default async function TaeAccessPage({ params }: { params: Promise<{ accessToken: string }> }) {
  const { accessToken } = await params
  return <TaeAccessActivation accessToken={accessToken} />
}
