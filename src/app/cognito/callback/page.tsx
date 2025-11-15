import { Flex, Heading, Text, Code, Button } from "@radix-ui/themes";
import CognitoSignInButton from "@/app/components/CognitoSignInButton";
import { headers } from "next/headers";
import { jwtDecode } from "jwt-decode";

type SearchParams = Promise<{
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
  code_verifier?: string;
}>;

const containerStyle = {
  maxWidth: "900px",
  width: "100%",
  padding: "16px",
  boxSizing: "border-box",
  minHeight: "0",
} as const;

async function exchangeCodeForToken(
  code: string,
  redirectUri: string,
  codeVerifier?: string
) {
  const domain = "https://us-east-1svpsecliw.auth.us-east-1.amazoncognito.com"
  const clientId = "742iteclmnpogeuvsun36jtcrs";
  const clientSecret = "ad2pgqaoe21omf7dc2a6i8t63u8050npdtbms9qra8k081s7nk3";

  if (!domain || !clientId) {
    return {
      ok: false as const,
      status: 500,
      data: {
        error: "server_misconfiguration",
        error_description: "COGNITO_DOMAIN and COGNITO_CLIENT_ID are required",
      },
    };
  }

  const tokenUrl =
    domain.startsWith("http://") || domain.startsWith("https://")
      ? `${domain.replace(/\/$/, "")}/oauth2/token`
      : `https://${domain.replace(/\/$/, "")}/oauth2/token`;

  const params = new URLSearchParams();
  params.set("grant_type", "authorization_code");
  params.set("client_id", clientId);
  params.set("code", code);
  params.set("redirect_uri", redirectUri);
  if (codeVerifier) {
    params.set("code_verifier", codeVerifier);
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };

  if (clientSecret) {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
      "base64"
    );
    headers["Authorization"] = `Basic ${credentials}`;
  }

  // Safe logging of outgoing request (with sensitive values redacted)
  const redact = (value?: string) =>
    value ? `${value.slice(0, 6)}...(${value.length})` : undefined;
  console.log("[Cognito Token Request]", {
    url: tokenUrl,
    method: "POST",
    headers: {
      "Content-Type": headers["Content-Type"],
      Authorization: headers["Authorization"] ? "[Basic REDACTED]" : undefined,
    },
    body: {
      grant_type: "authorization_code",
      client_id: clientId,
      redirect_uri: redirectUri,
      code: redact(code),
      code_verifier: redact(codeVerifier),
    },
  });

  let resp: Response;
  try {
    resp = await fetch(tokenUrl, {
      method: "POST",
      headers,
      body: params,
    });
  } catch (err: any) {
    console.error("[Cognito Token Request Error]", {
      message: err?.message ?? "Unknown error",
    });
    throw err;
  }

  const data = await resp.json().catch(() => ({}));

  // Log summary of the response (without token bodies)
  console.log("[Cognito Token Response]", {
    ok: resp.ok,
    status: resp.status,
  });

  // Optional: log full raw token response (includes tokens) when enabled
    console.log("[Cognito Token Response Raw]", data);


  return { ok: resp.ok, status: resp.status, data };
}

export default async function CognitoCallbackPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const resolved = await searchParams;
  const { code, error, error_description, code_verifier } = resolved;

  // Compute base URL and Cognito logout URL for the sign-out button
  const hdrs = await headers();
  const forwardedProto = hdrs.get("x-forwarded-proto") ?? undefined;
  const forwardedHost =
    hdrs.get("x-forwarded-host") ?? hdrs.get("host") ?? undefined;
  const computedBase =
    forwardedProto && forwardedHost
      ? `${forwardedProto}://${forwardedHost}`
      : undefined;

  const cognitoDomain = "https://us-east-1svpsecliw.auth.us-east-1.amazoncognito.com";
  const cognitoClientId = "742iteclmnpogeuvsun36jtcrs";
  const logoutBase =
    (cognitoDomain.startsWith("http://") || cognitoDomain.startsWith("https://")
      ? cognitoDomain.replace(/\/$/, "")
      : `https://${cognitoDomain.replace(/\/$/, "")}`) + "/logout";
  const postLogoutRedirect =
    process.env.COGNITO_POST_LOGOUT_REDIRECT_URI ??
    (computedBase ? `${computedBase}/` : "");
  const logoutUrl = `${logoutBase}?client_id=${encodeURIComponent(
    cognitoClientId
  )}&logout_uri=${encodeURIComponent(postLogoutRedirect)}`;

  if (error) {
    return (
      <Flex direction="column" gap="3" style={containerStyle}>
        <Heading size="6">Cognito Callback</Heading>
        <Flex gap="3">
          <CognitoSignInButton />
          <Button asChild variant="soft">
            <a href={logoutUrl}>Sign out of Cognito</a>
          </Button>
        </Flex>
        <Text color="red">Authorization Error</Text>
        <Code>{error}</Code>
        {error_description && <Text color="gray">{error_description}</Text>}
      </Flex>
    );
  }

  if (!code) {
    return (
      <Flex direction="column" gap="3" style={containerStyle}>
        <Heading size="6">Cognito Callback</Heading>
        <Flex gap="3">
          <CognitoSignInButton />
          <Button asChild variant="soft">
            <a href={logoutUrl}>Sign out of Cognito</a>
          </Button>
        </Flex>
        <Text color="gray">
          Missing authorization code. Ensure your app's redirect URI matches this
          page and includes the code parameter.
        </Text>
      </Flex>
    );
  }

  const redirectUri =
    `${computedBase ?? process.env.COGNITO_REDIRECT_URI ?? ""}/cognito/callback`;

  if (!redirectUri) {
    return (
      <Flex direction="column" gap="3" style={containerStyle}>
        <Heading size="6">Cognito Callback</Heading>
        <Text color="red">
          COGNITO_REDIRECT_URI is not configured in the environment.
        </Text>
      </Flex>
    );
  }

  const result = await exchangeCodeForToken(code, redirectUri, code_verifier);

  if (!result.ok) {
    return (
      <Flex direction="column" gap="3" style={containerStyle}>
        <Heading size="6">Cognito Callback</Heading>
        <Flex gap="3">
          <CognitoSignInButton />
          <Button asChild variant="soft">
            <a href={logoutUrl}>Sign out of Cognito</a>
          </Button>
        </Flex>
        <Text color="red">Token Exchange Failed</Text>
        <Text color="gray">Status: {result.status}</Text>
        <pre
          style={{
            backgroundColor: "var(--gray-2)",
            padding: "16px",
            borderRadius: "var(--radius-3)",
            border: "1px solid var(--gray-5)",
            overflow: "auto",
            fontSize: "12px",
            lineHeight: "1.4",
            maxHeight: "70vh",
          }}
        >
          {JSON.stringify(result.data, null, 2)}
        </pre>
      </Flex>
    );
  }

  const tokens = result.data as {
    id_token?: string;
    access_token?: string;
    refresh_token?: string;
    [key: string]: any;
  };

  const safeDecode = (token?: string) => {
    if (!token) return null;
    try {
      return jwtDecode(token as string);
    } catch {
      return { error: "Failed to decode token" };
    }
  };

  const decodedIdToken = safeDecode(tokens.id_token);
  const decodedAccessToken = safeDecode(tokens.access_token);

  // Log decoded tokens to server logs
  console.log("[Cognito Decoded Tokens]", {
    decodedIdToken,
    decodedAccessToken,
  });

  return (
    <Flex direction="column" gap="3" style={containerStyle}>
      <Heading size="6">Cognito Callback</Heading>
      <Flex gap="3">
        <CognitoSignInButton />
        <Button asChild variant="soft">
          <a href={logoutUrl}>Sign out of Cognito</a>
        </Button>
      </Flex>
      <Text color="green">Successfully exchanged authorization code.</Text>
      <Text color="gray">
        Below is the token response returned by Cognito.
      </Text>
      <pre
        style={{
          backgroundColor: "var(--gray-2)",
          padding: "16px",
          borderRadius: "var(--radius-3)",
          border: "1px solid var(--gray-5)",
          overflow: "auto",
          fontSize: "12px",
          lineHeight: "1.4",
          maxHeight: "70vh",
        }}
      >
        {JSON.stringify(result.data, null, 2)}
      </pre>
      <Heading size="4">Decoded ID Token</Heading>
      <pre
        style={{
          backgroundColor: "var(--gray-2)",
          padding: "16px",
          borderRadius: "var(--radius-3)",
          border: "1px solid var(--gray-5)",
          overflow: "auto",
          fontSize: "12px",
          lineHeight: "1.4",
          maxHeight: "70vh",
        }}
      >
        {JSON.stringify(decodedIdToken, null, 2)}
      </pre>
      <Heading size="4">Decoded Access Token</Heading>
      <pre
        style={{
          backgroundColor: "var(--gray-2)",
          padding: "16px",
          borderRadius: "var(--radius-3)",
          border: "1px solid var(--gray-5)",
          overflow: "auto",
          fontSize: "12px",
          lineHeight: "1.4",
          maxHeight: "70vh",
        }}
      >
        {JSON.stringify(decodedAccessToken, null, 2)}
      </pre>
    </Flex>
  );
}


