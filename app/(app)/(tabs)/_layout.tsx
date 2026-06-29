import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import React from 'react';
import BrandHeaderTitle from '../../../components/ui/BrandHeaderTitle';
import FloatingTabBar from '../../../components/ui/FloatingTabBar';
import { ACTIVE_ROLE } from '../../../lib/constants';
import { useRole } from '../../../lib/role-context';
import { colors } from '../../../lib/theme';

// Shared bottom-tab shell for every regular user. The four tabs (labels + icons)
// are the SAME for clients and workers — only the CONTENT of Feed and Hires
// changes based on the active role, which each screen reads from RoleContext.
//
// The client/worker switcher lives in the Settings (Profile) screen — see
// RoleSwitcher rendered there. It only shows for active workers.
//
// Visual only: a custom detached/floating tab bar (FloatingTabBar) renders the
// soft purple "bubble" that springs between tabs; the header shows the
// "circulaID" brand wordmark.
export default function TabsLayout() {
  // The first tab is role-aware: clients browse the "Feed", workers manage their
  // own skill posts on the "Job" screen. Only the label/icon change here; the
  // screen content is swapped inside feed.tsx based on the same activeRole.
  const { activeRole } = useRole();
  const isWorker = activeRole === ACTIVE_ROLE.WORKER;

  return (
    <Tabs
      tabBar={(props) => (
        <FloatingTabBar {...props} hiddenRouteNames={isWorker ? ['hires'] : []} />
      )}
      screenOptions={{
        headerTitle: () => <BrandHeaderTitle />,
        headerTitleAlign: 'left',
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen
        name="feed"
        options={{
          title: isWorker ? 'Job' : 'Feed',
          tabBarIcon: ({ color, size, focused }) => (
            <MaterialCommunityIcons
              name={
                isWorker
                  ? focused
                    ? 'briefcase'
                    : 'briefcase-outline'
                  : focused
                    ? 'view-grid'
                    : 'view-grid-outline'
              }
              color={color}
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="hires"
        options={{
          title: 'Hires',
          // Hires is a client-only concept here. The tab bar hides it in worker
          // view via the hiddenRouteNames prop above (see FloatingTabBar).
          tabBarIcon: ({ color, size, focused }) => (
            <MaterialCommunityIcons
              name={focused ? 'handshake' : 'handshake-outline'}
              color={color}
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: 'Chat',
          tabBarIcon: ({ color, size, focused }) => (
            <MaterialCommunityIcons
              name={focused ? 'chat' : 'chat-outline'}
              color={color}
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size, focused }) => (
            <MaterialCommunityIcons
              name={focused ? 'account' : 'account-outline'}
              color={color}
              size={size}
            />
          ),
        }}
      />
    </Tabs>
  );
}
