import { Button } from "@radix-ui/themes";
import { headers } from "next/headers";
import { randomUUID } from "node:crypto";

export default async function CognitoSignInButton() {
  const hdrs = await headers();
  const forwardedProto = hdrs.get("x-forwarded-proto") ?? undefined;
  const forwardedHost = hdrs.get("x-forwarded-host") ?? hdrs.get("host") ?? undefined;
  const computedBase = forwardedProto && forwardedHost ? `${forwardedProto}://${forwardedHost}` : undefined;

  const domain = process.env.COGNITO_DOMAIN ?? "";
  const clientId = process.env.COGNITO_CLIENT_ID ?? "";
  const redirectUri = `${computedBase ?? process.env.COGNITO_REDIRECT_URI ?? ""}/cognito/callback`;

  // Build authorize URL
  const authBase = (domain.startsWith("http://") || domain.startsWith("https://")
    ? domain.replace(/\/$/, "")
    : `https://${domain.replace(/\/$/, "")}`) + "/oauth2/authorize";

  const state = randomUUID();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: "openid email profile",
    state,
  });

  const authorizeUrl = `${authBase}?${params.toString()}`;

  return (
    <Button asChild variant="soft">
      <a href={authorizeUrl}>Sign in with Cognito</a>
    </Button>
  );
}


