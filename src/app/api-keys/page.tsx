import { withAuth } from "@workos-inc/authkit-nextjs";
import { Heading, Flex, Text } from "@radix-ui/themes";
import { workos } from "../workos";
import { ApiKeysWidget } from "../components/Widgets";

export default async function ApiKeysPage() {
  const { organizationId, user, role } = await withAuth({ ensureSignedIn: true });

  if (!organizationId) {
    return <Text size="3">User does not belong to an organization.</Text>;
  }

  if (role !== "admin") {
    return (
      <Flex direction="column" gap="2" mb="4">
        <Heading size="6">API Keys</Heading>
        <Text size="3" color="gray">
          Only Admin users can access this page.
        </Text>
      </Flex>
    );
  }

  const authToken = await workos.widgets.getToken({
    userId: user.id,
    organizationId,
    scopes: ["widgets:api-keys:manage"],
  });

  return (
    <Flex direction="column" gap="4" width="900px">
      <Heading size="6">API Keys</Heading>
      <Text size="3" color="gray">
        Manage organization API keys and their permissions.
      </Text>
      <ApiKeysWidget token={authToken} />
    </Flex>
  );
}



