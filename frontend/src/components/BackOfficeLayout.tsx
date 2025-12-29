import React, { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import ReportIcon from './icons/ReportIcon';
import UserPlusIcon from './icons/UserPlusIcon';
import TableIcon from './icons/TableIcon';
import MenuIcon from './icons/MenuIcon';
import OrderIcon from './icons/OrderIcon';

const navLinks = [
  { path: '/backoffice/basic-info', label: 'Business Info', icon: 'custom' },
  { path: '/backoffice/menu', label: 'Menu Manager', icon: 'custom' },
];

const tableSubMenus = [
  { path: '/backoffice/tables', label: 'Table Map Manager', icon: 'custom' },
  { path: '/backoffice/tables', label: 'Table Map', icon: '🗺️' },
  { path: '/backoffice/table-reservation-settings', label: 'Reservation', icon: '⚙️' },
];

const orderSubMenus = [
  { path: '/backoffice/order-setup', label: 'Order Screen Setup', icon: '⚙️' },
  { path: '/backoffice/togo-settings', label: 'Promotion', icon: '🎁' },
];

const employeeSubMenus = [
  { path: '/backoffice/employees', label: 'Employee Manager', icon: 'custom' },
  { path: '/backoffice/employee-info', label: 'Employee Info', icon: '👤' },
  { path: '/backoffice/work-schedule', label: 'Work Schedule', icon: '⏰' },
  { path: '/backoffice/shift-swaps', label: 'Shift Swaps', icon: '🔄' },
  { path: '/backoffice/time-off-request', label: 'Time off Request', icon: '📅' },
  { path: '/backoffice/employee-report', label: 'Employee Report', icon: '📊' },
  { path: '/backoffice/payroll-setting', label: 'Pay Roll Setting', icon: '💰' },
];

const hardwareSubMenus = [
  { path: '/backoffice/hardware', label: 'Hardware Manager', icon: '🖨️' },
  { path: '/backoffice/printer', label: 'Printer', icon: '🖨️' },
  { path: '/backoffice/credit-card-reader', label: 'Credit Card Reader', icon: '💳' },
  { path: '/backoffice/table-devices', label: 'Table Devices', icon: '📱' },
  { path: '/backoffice/qr-code', label: 'QR Code', icon: '📱' },
  { path: '/backoffice/kds', label: 'KDS', icon: '📺' },
];

const reportSubMenus = [
  { path: '/backoffice/reports', label: 'Report Manager', icon: 'custom' },
  { path: '/backoffice/sales-report', label: 'Sales Report', icon: '💰' },
  { path: '/backoffice/inventory-report', label: 'Inventory Report', icon: '📦' },
  { path: '/backoffice/customer-report', label: 'Customer Report', icon: '👥' },
  { path: '/backoffice/employee-performance', label: 'Employee Performance', icon: '📈' },
  { path: '/backoffice/menu-analysis', label: 'Menu Analysis', icon: '🍽️' },
  { path: '/backoffice/payment-report', label: 'Payment Report', icon: '💳' },
  { path: '/backoffice/operational-report', label: 'Operational Report', icon: '⚙️' },
];

const BackOfficeLayout = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [employeeMenuExpanded, setEmployeeMenuExpanded] = useState(false);
  const [hardwareMenuExpanded, setHardwareMenuExpanded] = useState(false);
  const [reportMenuExpanded, setReportMenuExpanded] = useState(false);
  const [tableMenuExpanded, setTableMenuExpanded] = useState(false);
  const [orderMenuExpanded, setOrderMenuExpanded] = useState(false);

  const toggleSidebar = () => {
    setSidebarCollapsed(!sidebarCollapsed);
  };

  const toggleEmployeeMenu = () => {
    setEmployeeMenuExpanded(!employeeMenuExpanded);
  };

  const toggleHardwareMenu = () => {
    setHardwareMenuExpanded(!hardwareMenuExpanded);
  };

  const toggleReportMenu = () => {
    setReportMenuExpanded(!reportMenuExpanded);
  };

  const toggleTableMenu = () => {
    setTableMenuExpanded(!tableMenuExpanded);
  };

  const toggleOrderMenu = () => {
    setOrderMenuExpanded(!orderMenuExpanded);
  };

  const renderIcon = (label: string, icon: string, size: number) => {
    if (icon === 'custom') {
      if (label === 'Menu Manager') {
        return <MenuIcon size={size} />;
      } else if (label === 'Employee Manager') {
        return <UserPlusIcon size={size} />;
      } else if (label === 'Table Map Manager') {
        return <TableIcon size={size} />;
      } else if (label === 'Order Screen Manager') {
        return <OrderIcon size={size} />;
      } else if (label === 'Business Info') {
        return <ReportIcon size={size} />;
      } else {
        return <ReportIcon size={size} />;
      }
    } else {
      return (
        <span className={`flex items-center justify-center transition-all duration-300 ease-in-out ${sidebarCollapsed ? 'text-2xl' : 'text-base'}`}>
          {icon}
        </span>
      );
    }
  };

  return (
    <div className="flex h-screen bg-gray-100 font-sans">
      <aside className={`${sidebarCollapsed ? 'w-16' : 'w-64'} bg-gray-800 text-white flex flex-col transition-all duration-300 ease-in-out`}>
        <div className="h-16 flex items-center justify-center px-4 border-b border-gray-700">
          {!sidebarCollapsed && <span className="text-2xl font-bold">The Zone POS</span>}
        </div>
        <nav className="flex-1 px-4 py-4">
          <ul>
            {/* Regular menu items */}
            {navLinks.map(({ path, label, icon }) => (
              <li key={path}>
                <NavLink
                  to={path}
                  className={({ isActive }) =>
                    `flex items-center px-3 py-3 mb-2 rounded-md transition-colors ${
                      isActive ? 'bg-blue-500 text-white' : 'hover:bg-gray-700'
                    } ${sidebarCollapsed ? 'justify-center -ml-3' : ''}`
                  }
                  title={sidebarCollapsed ? label : ''}
                >
                  <span className={`inline-block text-center mr-3 flex items-center justify-center transition-all duration-300 ease-in-out ${sidebarCollapsed ? 'w-14' : 'w-6'}`}>
                    {renderIcon(label, icon, sidebarCollapsed ? 32 : 16)}
                  </span>
                  <span className={`transition-all duration-300 ease-in-out overflow-hidden whitespace-nowrap ${sidebarCollapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'}`}>
                    {label}
                  </span>
                </NavLink>
              </li>
            ))}

            {/* Table Map Manager with dropdown */}
            <li className="mb-2">
              <button
                onClick={toggleTableMenu}
                className={`flex items-center px-3 py-3 w-full rounded-md transition-colors ${
                  tableMenuExpanded 
                    ? 'bg-gray-600 text-white hover:bg-gray-500' 
                    : 'hover:bg-gray-700'
                } ${sidebarCollapsed ? 'justify-center -ml-3' : ''}`}
                title={sidebarCollapsed ? 'Table Map Manager' : ''}
              >
                <span className={`inline-block text-center mr-3 flex items-center justify-center transition-all duration-300 ease-in-out ${sidebarCollapsed ? 'w-14' : 'w-6'}`}>
                  <TableIcon size={sidebarCollapsed ? 32 : 16} />
                </span>
                <span className={`transition-all duration-300 ease-in-out overflow-hidden whitespace-nowrap ${sidebarCollapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'}`}>
                  Table Map Manager
                </span>
                {!sidebarCollapsed && (
                  <span className={`ml-auto transition-transform duration-300 ${tableMenuExpanded ? 'rotate-180' : ''}`}>
                    ▼
                  </span>
                )}
              </button>
              
              {/* Table submenu */}
              {tableMenuExpanded && !sidebarCollapsed && (
                <ul className="ml-4 space-y-1 bg-gray-700 rounded-md p-2 mt-1">
                  {tableSubMenus.slice(1).map(({ path, label, icon }) => (
                    <li key={path}>
                      <NavLink
                        to={path}
                        className={({ isActive }) =>
                          `flex items-center px-3 py-2 rounded-md transition-colors text-sm ${
                            isActive 
                              ? 'bg-gray-500 text-white' 
                              : 'text-gray-200 hover:bg-gray-600'
                          }`
                        }
                      >
                        <span className="mr-3 text-sm">{icon}</span>
                        <span>{label}</span>
                      </NavLink>
                    </li>
                  ))}
                </ul>
              )}
            </li>

            {/* Order Screen Manager with dropdown */}
            <li className="mb-2">
              <button
                onClick={toggleOrderMenu}
                className={`flex items-center px-3 py-3 w-full rounded-md transition-colors ${
                  orderMenuExpanded 
                    ? 'bg-gray-600 text-white hover:bg-gray-500' 
                    : 'hover:bg-gray-700'
                } ${sidebarCollapsed ? 'justify-center -ml-3' : ''}`}
                title={sidebarCollapsed ? 'Order Screen Manager' : ''}
              >
                <span className={`inline-block text-center mr-3 flex items-center justify-center transition-all duration-300 ease-in-out ${sidebarCollapsed ? 'w-14' : 'w-6'}`}>
                  <OrderIcon size={sidebarCollapsed ? 32 : 16} />
                </span>
                <span className={`transition-all duration-300 ease-in-out overflow-hidden whitespace-nowrap ${sidebarCollapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'}`}>
                  Order Screen Manager
                </span>
                {!sidebarCollapsed && (
                  <span className={`ml-auto transition-transform duration-300 ${orderMenuExpanded ? 'rotate-180' : ''}`}>
                    ▼
                  </span>
                )}
              </button>
              
              {/* Order submenu */}
              {orderMenuExpanded && !sidebarCollapsed && (
                <ul className="ml-4 space-y-1 bg-gray-700 rounded-md p-2 mt-1">
                  {orderSubMenus.map(({ path, label, icon }) => (
                    <li key={path}>
                      <NavLink
                        to={path}
                        className={({ isActive }) =>
                          `flex items-center px-3 py-2 rounded-md transition-colors text-sm ${
                            isActive 
                              ? 'bg-gray-500 text-white' 
                              : 'text-gray-200 hover:bg-gray-600'
                          }`
                        }
                      >
                        <span className="mr-3 text-sm">{icon}</span>
                        <span>{label}</span>
                      </NavLink>
                    </li>
                  ))}
                </ul>
              )}
            </li>

            {/* Employee Manager with dropdown */}
            <li className="mb-2">
              <button
                onClick={toggleEmployeeMenu}
                className={`flex items-center px-3 py-3 w-full rounded-md transition-colors ${
                  employeeMenuExpanded 
                    ? 'bg-gray-600 text-white hover:bg-gray-500' 
                    : 'hover:bg-gray-700'
                } ${sidebarCollapsed ? 'justify-center -ml-3' : ''}`}
                title={sidebarCollapsed ? 'Employee Manager' : ''}
              >
                <span className={`inline-block text-center mr-3 flex items-center justify-center transition-all duration-300 ease-in-out ${sidebarCollapsed ? 'w-14' : 'w-6'}`}>
                  <UserPlusIcon size={sidebarCollapsed ? 32 : 16} />
                </span>
                <span className={`transition-all duration-300 ease-in-out overflow-hidden whitespace-nowrap ${sidebarCollapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'}`}>
                  Employee Manager
                </span>
                {!sidebarCollapsed && (
                  <span className={`ml-auto transition-transform duration-300 ${employeeMenuExpanded ? 'rotate-180' : ''}`}>
                    ▼
                  </span>
                )}
              </button>
              
              {/* Employee submenu */}
              {employeeMenuExpanded && !sidebarCollapsed && (
                <ul className="ml-4 space-y-1 bg-gray-700 rounded-md p-2 mt-1">
                  {employeeSubMenus.slice(1).map(({ path, label, icon }) => (
                    <li key={path}>
                      <NavLink
                        to={path}
                        className={({ isActive }) =>
                          `flex items-center px-3 py-2 rounded-md transition-colors text-sm ${
                            isActive 
                              ? 'bg-gray-500 text-white' 
                              : 'text-gray-200 hover:bg-gray-600'
                          }`
                        }
                      >
                        <span className="mr-3 text-sm">{icon}</span>
                        <span>{label}</span>
                      </NavLink>
                    </li>
                  ))}
                </ul>
              )}
            </li>

            {/* Hardware Manager with dropdown */}
            <li className="mb-2">
              <button
                onClick={toggleHardwareMenu}
                className={`flex items-center px-3 py-3 w-full rounded-md transition-colors ${
                  hardwareMenuExpanded 
                    ? 'bg-gray-600 text-white hover:bg-gray-500' 
                    : 'hover:bg-gray-700'
                } ${sidebarCollapsed ? 'justify-center -ml-3' : ''}`}
                title={sidebarCollapsed ? 'Hardware Manager' : ''}
              >
                <span className={`inline-block text-center mr-3 flex items-center justify-center transition-all duration-300 ease-in-out ${sidebarCollapsed ? 'w-14' : 'w-6'}`}>
                  <span className={`flex items-center justify-center transition-all duration-300 ease-in-out ${sidebarCollapsed ? 'text-2xl' : 'text-base'}`}>
                    ��️
                  </span>
                </span>
                <span className={`transition-all duration-300 ease-in-out overflow-hidden whitespace-nowrap ${sidebarCollapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'}`}>
                  Hardware Manager
                </span>
                {!sidebarCollapsed && (
                  <span className={`ml-auto transition-transform duration-300 ${hardwareMenuExpanded ? 'rotate-180' : ''}`}>
                    ▼
                  </span>
                )}
              </button>
              
              {/* Hardware submenu */}
              {hardwareMenuExpanded && !sidebarCollapsed && (
                <ul className="ml-4 space-y-1 bg-gray-700 rounded-md p-2 mt-1">
                  {hardwareSubMenus.slice(1).map(({ path, label, icon }) => (
                    <li key={path}>
                      <NavLink
                        to={path}
                        className={({ isActive }) =>
                          `flex items-center px-3 py-2 rounded-md transition-colors text-sm ${
                            isActive 
                              ? 'bg-gray-500 text-white' 
                              : 'text-gray-200 hover:bg-gray-600'
                          }`
                        }
                      >
                        <span className="mr-3 text-sm">{icon}</span>
                        <span>{label}</span>
                      </NavLink>
                    </li>
                  ))}
                </ul>
              )}
            </li>

            {/* Report Manager with dropdown */}
            <li className="mb-2">
              <button
                onClick={toggleReportMenu}
                className={`flex items-center px-3 py-3 w-full rounded-md transition-colors ${
                  reportMenuExpanded 
                    ? 'bg-gray-600 text-white hover:bg-gray-500' 
                    : 'hover:bg-gray-700'
                } ${sidebarCollapsed ? 'justify-center -ml-3' : ''}`}
                title={sidebarCollapsed ? 'Report Manager' : ''}
              >
                <span className={`inline-block text-center mr-3 flex items-center justify-center transition-all duration-300 ease-in-out ${sidebarCollapsed ? 'w-14' : 'w-6'}`}>
                  <ReportIcon size={sidebarCollapsed ? 32 : 16} />
                </span>
                <span className={`transition-all duration-300 ease-in-out overflow-hidden whitespace-nowrap ${sidebarCollapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'}`}>
                  Report Manager
                </span>
                {!sidebarCollapsed && (
                  <span className={`ml-auto transition-transform duration-300 ${reportMenuExpanded ? 'rotate-180' : ''}`}>
                    ▼
                  </span>
                )}
              </button>
              
              {/* Report submenu */}
              {reportMenuExpanded && !sidebarCollapsed && (
                <ul className="ml-4 space-y-1 bg-gray-700 rounded-md p-2 mt-1">
                  {reportSubMenus.slice(1).map(({ path, label, icon }) => (
                    <li key={path}>
                      <NavLink
                        to={path}
                        className={({ isActive }) =>
                          `flex items-center px-3 py-2 rounded-md transition-colors text-sm ${
                            isActive 
                              ? 'bg-gray-500 text-white' 
                              : 'text-gray-200 hover:bg-gray-600'
                          }`
                        }
                      >
                        <span className="mr-3 text-sm">{icon}</span>
                        <span>{label}</span>
                      </NavLink>
                    </li>
                  ))}
                </ul>
              )}
            </li>

          </ul>
          
          {/* Toggle Button */}
          <div className="px-4 py-2 border-t border-gray-700 flex justify-center">
            <button
              onClick={toggleSidebar}
              className={`rounded-lg border-2 border-white hover:bg-gray-700 transition-colors font-bold flex items-center justify-center ${sidebarCollapsed ? 'w-14 h-14 text-xl' : 'w-12 h-12 text-3xl'}`}
              style={{ aspectRatio: '1 / 1' }}
              title={sidebarCollapsed ? '사이드바 펼치기' : '사이드바 접기'}
            >
              <span className="flex items-center justify-center w-full h-full">
                {sidebarCollapsed ? '›' : '‹'}
              </span>
            </button>
          </div>
        </nav>
      </aside>
      <main className="flex-1 flex flex-col overflow-auto">
        {/* The Outlet will render the matched child route component */}
        <Outlet />
      </main>
    </div>
  );
};

export default BackOfficeLayout;