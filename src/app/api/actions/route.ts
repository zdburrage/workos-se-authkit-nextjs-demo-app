import { SignatureVerificationException } from "@workos-inc/node";
import { workos } from "../../workos";

type Verdict = "Allow" | "Deny";

type ActionResponse = {
  type: "authentication" | "user_registration";
  verdict: Verdict;
  errorMessage?: string;
};

function getActionsSecret(): string {
  const secret = process.env.ACTIONS_SECRET;
  if (!secret) throw new Error("ACTIONS_SECRET is required");
  return secret;
}

export async function POST(req: Request) {
  const payload = await req.json();
  const sigHeader = req.headers.get("workos-signature");
  const secret = getActionsSecret();

  let action;
  try {
    action = await workos.actions.constructAction({
      payload,
      sigHeader: sigHeader as string,
      secret,
    });
  } catch (err) {
    if (err instanceof SignatureVerificationException) {
      console.error("Action signature verification failed:", err.message);
      return Response.json({ error: "Invalid signature" }, { status: 401 });
    }
    throw err;
  }

  let responsePayload: ActionResponse;

  if (action?.object === "authentication_action_context") {
    responsePayload = await handleAuthentication(action);
  } else if (action?.object === "user_registration_action_context") {
    responsePayload = handleRegistration(action);
  } else {
    responsePayload = { type: "authentication", verdict: "Allow" };
  }

  console.log(
    `[Action] ${action?.object} → ${responsePayload.verdict}${responsePayload.errorMessage ? `: ${responsePayload.errorMessage}` : ""}`
  );

  return Response.json(
    await workos.actions.signResponse(responsePayload, secret)
  );
}

// --- Authentication Action ---
// Checks user metadata for deny flags before allowing login.
//
// Supported metadata keys:
//   "suspended": "true"       → blocks login with a suspended message
//   "deny_login": "true"      → blocks login with a generic or custom message
//   "deny_message": "string"  → custom error shown when denied
//
// Set metadata on a user via the WorkOS Dashboard or API:
//   workos.userManagement.updateUser(userId, { metadata: { suspended: "true" } })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleAuthentication(action: any): Promise<ActionResponse> {
  const userId = action.user?.id;

  // Fetch full user to access metadata
  if (userId) {
    try {
      const user = await workos.userManagement.getUser(userId);
      const metadata = (user.metadata ?? {}) as Record<string, string>;

      if (metadata.suspended === "true") {
        return {
          type: "authentication",
          verdict: "Deny",
          errorMessage:
            metadata.deny_message ??
            "Your account has been suspended. Please contact your administrator.",
        };
      }

      if (metadata.deny_login === "true") {
        return {
          type: "authentication",
          verdict: "Deny",
          errorMessage:
            metadata.deny_message ??
            "You are not authorized to sign in at this time.",
        };
      }
    } catch (err) {
      console.error("[Action] Failed to fetch user metadata:", err);
    }
  }

  return { type: "authentication", verdict: "Allow" };
}

// --- User Registration Action ---
// Blocks sign-up from personal email providers.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handleRegistration(action: any): ActionResponse {
  const email = action.userData?.email ?? "";
  const domain = email.split("@")[1] ?? "";

  const blockedDomains = ["yahoo.com", "hotmail.com", "outlook.com"];
  if (blockedDomains.includes(domain)) {
    return {
      type: "user_registration",
      verdict: "Deny",
      errorMessage: `Registration with @${domain} is not permitted. Please use your corporate email address.`,
    };
  }

  return { type: "user_registration", verdict: "Allow" };
}
