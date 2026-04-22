import clsx from 'clsx';
import React from 'react';
import {ThemeClassNames} from '@docusaurus/theme-common';
import {useNavbarSecondaryMenu} from '@docusaurus/theme-common/internal';

type NavbarMobileSidebarLayoutProps = {
  header: React.ReactNode;
  primaryMenu: React.ReactNode;
  secondaryMenu: React.ReactNode;
};

export default function NavbarMobileSidebarLayout({
  header,
  primaryMenu,
  secondaryMenu,
}: NavbarMobileSidebarLayoutProps) {
  const navbarSecondaryMenu = useNavbarSecondaryMenu();
  const showSecondaryPanel =
    navbarSecondaryMenu.shown && Boolean(navbarSecondaryMenu.content);

  return (
    <div
      className={clsx(
        ThemeClassNames.layout.navbar.mobileSidebar.container,
        'navbar-sidebar',
      )}>
      {header}
      <div className="navbar-sidebar__items">
        <div
          className={clsx(
            ThemeClassNames.layout.navbar.mobileSidebar.panel,
            'navbar-sidebar__item menu',
          )}>
          {showSecondaryPanel ? secondaryMenu : primaryMenu}
        </div>
      </div>
    </div>
  );
}
