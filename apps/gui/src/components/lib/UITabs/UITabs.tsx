import { ReactElement, ReactNode, SyntheticEvent, useState } from 'react';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import { Box, BoxProps } from '@mui/material';
import TabPanel, { TabPanelProps } from '@mui/lab/TabPanel';
import TabContext from '@mui/lab/TabContext';

export interface UiTab {
  key: string;
  label: string | ReactElement | ReactNode;
  Component: any; //TODO
  disabled?: boolean;
}

export interface UITabsProps extends BoxProps {
  className?: string;
  tabs: UiTab[];
  ariaLabel?: string;
  activeTab?: string;
  onTabsChange?: (newValue: string) => void;
  stretchTab?: boolean;
  slotProps?: {
    TabPanelProps?: Omit<TabPanelProps, 'value'>;
  };
}

export const getTabId = (index: number) => `tab-${index}`;

export const getTabpanelId = (index: number) => `tabpanel-${index}`;

export const a11yProps = (index: number) => ({
  id: getTabId(index),
  'aria-controls': getTabpanelId(index),
});

export const UITabs = ({
  className,
  tabs,
  ariaLabel,
  activeTab,
  onTabsChange,
  stretchTab = false,
  slotProps,
  ...boxProps
}: UITabsProps) => {
  let initialActiveTab;

  if (!activeTab) {
    initialActiveTab = tabs[0].key;
  } else {
    const tabsKeys = tabs.map(({ key }) => key);

    if (!tabsKeys.includes(activeTab)) {
      console.warn('activeTab does not exist in the tabs list');

      initialActiveTab = tabs[0].key;
    } else {
      initialActiveTab = activeTab;
    }
  }

  const [tabValue, setTabValue] = useState(initialActiveTab);
  const handleTabChange = (event: SyntheticEvent, newValue: string) => {
    setTabValue(newValue);
    if (onTabsChange) {
      onTabsChange(newValue);
    }
  };
  let stretchTabStyles: any = {};

  if (stretchTab) {
    stretchTabStyles = { maxWidth: 'none', flexGrow: 1 };
  }

  return (
    <Box className={className} {...boxProps}>
      <TabContext value={tabValue}>
        <Box>
          <Tabs
            value={tabValue}
            onChange={handleTabChange}
            aria-label={ariaLabel}
          >
            {tabs.map(({ label, key, disabled }, index) => (
              <Tab
                key={key}
                value={key}
                disabled={disabled}
                sx={stretchTabStyles}
                label={label}
                {...a11yProps(index)}
              />
            ))}
          </Tabs>
        </Box>
        {tabs.map(({ key, Component }) => (
          <TabPanel key={key} value={key} {...slotProps?.TabPanelProps}>
            {typeof Component === 'function' ? <Component /> : Component}
          </TabPanel>
        ))}
      </TabContext>
    </Box>
  );
};

export default UITabs;
