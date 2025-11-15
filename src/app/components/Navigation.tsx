import { withAuth } from "@workos-inc/authkit-nextjs";
import { Button, Flex, Box, Text } from "@radix-ui/themes";
import NextLink from "next/link";
import { OrganizationSwitcherWidget } from "./Widgets";
import { workos } from "../workos";
import CognitoSignInButton from "@/app/components/CognitoSignInButton";

export async function Navigation() {
  const { organizationId, user } = await withAuth({});

  const PROSPECT_LOGO = process.env.PROSPECT_LOGO;

  let authToken: string | null = null;
  if (user && organizationId) {
    authToken = await workos.widgets.getToken({
      userId: user.id,
      organizationId,
    });
  }

  return (
    <Flex gap="4">
      <Box mr="2" style={{ fontSize: "24px" }}>
        <img
          src={PROSPECT_LOGO}
          alt=""
          style={{ height: "30px", width: "30px" }}
        />
      </Box>
      <Button asChild variant="soft">
        <NextLink href="/">Home</NextLink>
      </Button>
      <Button asChild variant="soft">
        <NextLink href="/dsync-events">DSync Events</NextLink>
      </Button>
      <CognitoSignInButton />
      {user && (
        <>
          <Button asChild variant="soft">
            <NextLink href="/api-keys">API Keys</NextLink>
          </Button>
          <Button asChild variant="soft">
            <NextLink href="/user-settings">Settings</NextLink>
          </Button>
          {authToken && <OrganizationSwitcherWidget authToken={authToken} />}
        </>
      )}
    </Flex>
  );
}
