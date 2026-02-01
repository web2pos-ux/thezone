// frontend/src/pages/ReportsDashboardPage.tsx
// Reports Dashboard V2 - Combined Reports + Excel Download

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart3, TrendingUp, PieChart, Calendar, Clock, Users, DollarSign,
  Printer, Download, RefreshCw, ChevronRight, Search,
  ShoppingBag, CreditCard, Utensils,
  ArrowLeft, X, FileText, Activity, Layers, FileSpreadsheet
} from 'lucide-react';
import { API_URL } from '../config/constants';

// ==================== Types ====================
interface ReportDefinition {
  id: string;
  name: string;
  category: string;
  type: string;
  sections?: string[];
  description: string;
  printable?: boolean;
}

interface ReportSection {
  title: string;
  chartType: string;
  data: any[];
  summary?: Record<string, any>;
}

interface ReportData {
  report: ReportDefinition;
  dateRange: { start: string; end: string };
  generatedAt: string;
  data: {
    sections?: Record<string, ReportSection>;
    [key: string]: any;
  };
}

// ==================== Chart Components ====================

const SimpleBarChart: React.FC<{ data: any[]; valueKey: string; labelKey: string; color?: string }> = ({ 
  data, valueKey, labelKey, color = '#10b981' 
}) => {
  if (!data || data.length === 0) return <div className="text-slate-400 text-center py-4">No data</div>;
  
  const maxValue = Math.max(...data.map(d => d[valueKey] || 0));
  
  return (
    <div className="space-y-2">
      {data.slice(0, 10).map((item, idx) => (
        <div key={idx} className="flex items-center gap-3">
          <div className="w-20 text-xs text-slate-600 truncate">{item[labelKey]}</div>
          <div className="flex-1 h-5 bg-slate-100 rounded-full overflow-hidden">
            <div 
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${maxValue > 0 ? (item[valueKey] / maxValue * 100) : 0}%`, backgroundColor: color }}
            />
          </div>
          <div className="w-16 text-right text-xs font-medium">
            {typeof item[valueKey] === 'number' ? 
              (item[valueKey] >= 1 ? item[valueKey].toLocaleString() : `$${item[valueKey].toFixed(2)}`) : 
              item[valueKey]}
          </div>
        </div>
      ))}
    </div>
  );
};

const SimplePieChart: React.FC<{ data: any[]; valueKey: string; labelKey: string }> = ({ data, valueKey, labelKey }) => {
  if (!data || data.length === 0) return <div className="text-slate-400 text-center py-4">No data</div>;
  
  const total = data.reduce((sum, d) => sum + (d[valueKey] || 0), 0);
  const colors = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
  
  return (
    <div className="flex items-center gap-4">
      <div className="relative w-24 h-24">
        <svg viewBox="0 0 100 100" className="transform -rotate-90">
          {(() => {
            let cumulative = 0;
            return data.slice(0, 6).map((item, idx) => {
              const pct = total > 0 ? (item[valueKey] / total * 100) : 0;
              const startAngle = cumulative * 3.6;
              cumulative += pct;
              const endAngle = cumulative * 3.6;
              
              if (pct === 0) return null;
              
              const x1 = 50 + 40 * Math.cos(startAngle * Math.PI / 180);
              const y1 = 50 + 40 * Math.sin(startAngle * Math.PI / 180);
              const x2 = 50 + 40 * Math.cos(endAngle * Math.PI / 180);
              const y2 = 50 + 40 * Math.sin(endAngle * Math.PI / 180);
              
              return (
                <path
                  key={idx}
                  d={`M 50 50 L ${x1} ${y1} A 40 40 0 ${pct > 50 ? 1 : 0} 1 ${x2} ${y2} Z`}
                  fill={colors[idx % colors.length]}
                  stroke="white"
                  strokeWidth="1"
                />
              );
            });
          })()}
        </svg>
      </div>
      <div className="flex-1 space-y-1">
        {data.slice(0, 5).map((item, idx) => (
          <div key={idx} className="flex items-center gap-2 text-xs">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: colors[idx % colors.length] }} />
            <span className="text-slate-600 truncate flex-1">{item[labelKey]}</span>
            <span className="font-medium">{item.percentage || 0}%</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const SimpleLineChart: React.FC<{ data: any[]; valueKey: string; labelKey: string; color?: string }> = ({ 
  data, valueKey, labelKey, color = '#3b82f6' 
}) => {
  if (!data || data.length === 0) return <div className="text-slate-400 text-center py-4">No data</div>;
  
  const maxVal = Math.max(...data.map(d => d[valueKey] || 0));
  const minVal = Math.min(...data.map(d => d[valueKey] || 0));
  const range = maxVal - minVal || 1;
  
  const points = data.map((d, i) => ({
    x: (i / (data.length - 1 || 1)) * 100,
    y: 100 - ((d[valueKey] - minVal) / range * 80 + 10)
  }));
  
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  
  return (
    <div className="relative h-32">
      <svg viewBox="0 0 100 100" className="w-full h-full" preserveAspectRatio="none">
        <path d={`${pathD} L 100 100 L 0 100 Z`} fill={`${color}20`} />
        <path d={pathD} fill="none" stroke={color} strokeWidth="2" />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="1.5" fill={color} />
        ))}
      </svg>
    </div>
  );
};

// ==================== Section Renderer ====================

const SectionRenderer: React.FC<{ section: ReportSection }> = ({ section }) => {
  const renderChart = () => {
    const { data, chartType } = section;
    
    switch (chartType) {
      case 'bar':
      case 'horizontal-bar':
      case 'stacked-bar':
        return <SimpleBarChart data={data} valueKey="revenue" labelKey="label" />;
      case 'pie':
      case 'donut':
        return <SimplePieChart data={data} valueKey="revenue" labelKey="category" />;
      case 'line':
      case 'area':
        return <SimpleLineChart data={data} valueKey="revenue" labelKey="date" />;
      case 'heatmap':
        return (
          <div className="grid grid-cols-24 gap-0.5">
            {section.data?.slice(0, 168).map((cell: any, i: number) => (
              <div
                key={i}
                className="w-3 h-3 rounded-sm"
                style={{ 
                  backgroundColor: cell.revenue > 0 
                    ? `rgba(16, 185, 129, ${Math.min(cell.revenue / 500, 1)})` 
                    : '#f1f5f9'
                }}
                title={`${cell.dayName} ${cell.hour}:00 - $${cell.revenue}`}
              />
            ))}
          </div>
        );
      default:
        if (data && data.length > 0) {
          const firstKey = Object.keys(data[0]).find(k => typeof data[0][k] === 'number');
          const labelKey = Object.keys(data[0]).find(k => typeof data[0][k] === 'string') || 'label';
          return <SimpleBarChart data={data} valueKey={firstKey || 'value'} labelKey={labelKey} />;
        }
        return <div className="text-slate-400 text-center py-4">Chart type: {chartType}</div>;
    }
  };
  
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h4 className="font-bold text-slate-700 mb-3">{section.title}</h4>
      {renderChart()}
      
      {section.summary && Object.keys(section.summary).length > 0 && (
        <div className="mt-4 pt-3 border-t border-slate-100 grid grid-cols-3 gap-2">
          {Object.entries(section.summary).slice(0, 3).map(([key, val]) => (
            <div key={key} className="text-center">
              <p className="text-xs text-slate-500">{key.replace(/([A-Z])/g, ' $1').trim()}</p>
              <p className="font-bold text-slate-800">
                {typeof val === 'number' 
                  ? (key.toLowerCase().includes('revenue') || key.toLowerCase().includes('total') 
                    ? `$${val.toFixed(2)}` 
                    : val.toLocaleString())
                  : String(val)
                }
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ==================== Report Viewer Modal ====================

const ReportViewerModal: React.FC<{
  report: ReportDefinition;
  onClose: () => void;
}> = ({ report, onClose }) => {
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [printText, setPrintText] = useState<string | null>(null);
  
  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/reports-v2/${report.id}?startDate=${startDate}&endDate=${endDate}`);
      if (res.ok) {
        const result = await res.json();
        setData(result);
      }
    } catch (error) {
      console.error('Failed to load report:', error);
    } finally {
      setLoading(false);
    }
  }, [report.id, startDate, endDate]);
  
  const loadPrintFormat = useCallback(async () => {
    if (!report.printable) return;
    try {
      const res = await fetch(`${API_URL}/reports-v2/${report.id}/print?startDate=${startDate}`);
      if (res.ok) {
        const text = await res.text();
        setPrintText(text);
      }
    } catch (error) {
      console.error('Failed to load print format:', error);
    }
  }, [report.id, startDate, report.printable]);
  
  useEffect(() => {
    loadReport();
    loadPrintFormat();
  }, [loadReport, loadPrintFormat]);
  
  const handlePrint = () => {
    if (!printText) return;
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(`
        <html><head><title>${report.name}</title>
        <style>body { font-family: 'Courier New', monospace; font-size: 12px; white-space: pre; margin: 20px; }</style>
        </head><body>${printText}</body></html>
      `);
      printWindow.document.close();
      printWindow.print();
    }
  };
  
  const handleExcelDownload = () => {
    window.open(`${API_URL}/reports-v2/${report.id}/excel?startDate=${startDate}&endDate=${endDate}`, '_blank');
  };
  
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white">{report.name}</h2>
            <p className="text-emerald-100 text-sm">{report.description}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-lg transition">
            <X className="w-5 h-5 text-white" />
          </button>
        </div>
        
        {/* Controls */}
        <div className="px-6 py-4 bg-slate-50 border-b flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-slate-500" />
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
            />
            <span className="text-slate-400">to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
            />
          </div>
          
          <button
            onClick={loadReport}
            className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          
          <button
            onClick={handleExcelDownload}
            className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition flex items-center gap-2"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Download Excel
          </button>
          
          {report.printable && (
            <button
              onClick={handlePrint}
              className="px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600 transition flex items-center gap-2"
            >
              <Printer className="w-4 h-4" />
              Print
            </button>
          )}
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <RefreshCw className="w-8 h-8 text-emerald-500 animate-spin" />
            </div>
          ) : data?.data?.sections ? (
            // Combined Report
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {Object.entries(data.data.sections).map(([key, section]) => (
                <SectionRenderer key={key} section={section as ReportSection} />
              ))}
            </div>
          ) : report.printable && printText ? (
            // Printable Report
            <pre className="bg-slate-900 text-green-400 p-6 rounded-xl font-mono text-sm overflow-x-auto whitespace-pre">
              {printText}
            </pre>
          ) : (
            // Single Report
            <div className="bg-white rounded-xl border border-slate-200 p-6">
              {data?.data?.data && (
                <SimpleBarChart 
                  data={data.data.data} 
                  valueKey="revenue" 
                  labelKey={Object.keys(data.data.data[0] || {}).find(k => typeof data.data.data[0][k] === 'string') || 'label'} 
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ==================== Report Card ====================

const ReportCard: React.FC<{
  report: ReportDefinition;
  onClick: () => void;
}> = ({ report, onClick }) => {
  const getIcon = () => {
    if (report.printable) return <FileText className="w-5 h-5" />;
    if (report.type === 'combined') return <Layers className="w-5 h-5" />;
    return <BarChart3 className="w-5 h-5" />;
  };
  
  const getColor = () => {
    if (report.printable) return 'bg-amber-500';
    if (report.type === 'combined') return 'bg-indigo-500';
    if (report.category === 'employee') return 'bg-purple-500';
    return 'bg-emerald-500';
  };
  
  return (
    <button
      onClick={onClick}
      className="bg-white rounded-xl p-4 shadow-sm hover:shadow-md transition-all text-left border border-slate-100 hover:border-emerald-200 group"
    >
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 ${getColor()} rounded-lg flex items-center justify-center text-white shrink-0`}>
          {getIcon()}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-slate-800 text-sm group-hover:text-emerald-600 transition-colors line-clamp-1">
            {report.name}
          </h3>
          <p className="text-xs text-slate-500 mt-1 line-clamp-2">{report.description}</p>
        </div>
        <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-emerald-500 transition-colors shrink-0" />
      </div>
      
      <div className="flex gap-2 mt-3">
        {report.printable && (
          <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs rounded-full flex items-center gap-1">
            <Printer className="w-3 h-3" /> Printable
          </span>
        )}
        {report.type === 'combined' && (
          <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-xs rounded-full flex items-center gap-1">
            <Layers className="w-3 h-3" /> Combined
          </span>
        )}
        {report.sections && (
          <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs rounded-full">
            {report.sections.length} sections
          </span>
        )}
      </div>
    </button>
  );
};

// ==================== Main Component ====================

const ReportsDashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const [reports, setReports] = useState<{
    printable: ReportDefinition[];
    combined: ReportDefinition[];
    sales: ReportDefinition[];
    employee: ReportDefinition[];
  }>({ printable: [], combined: [], sales: [], employee: [] });
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'printable' | 'combined' | 'sales' | 'employee'>('all');
  const [selectedReport, setSelectedReport] = useState<ReportDefinition | null>(null);
  const [syncing, setSyncing] = useState(false);
  
  useEffect(() => {
    const loadReports = async () => {
      try {
        const res = await fetch(`${API_URL}/reports-v2`);
        if (res.ok) {
          const data = await res.json();
          setReports(data.reports || { printable: [], combined: [], sales: [], employee: [] });
        }
      } catch (error) {
        console.error('Failed to load reports:', error);
      } finally {
        setLoading(false);
      }
    };
    loadReports();
  }, []);
  
  const handleSyncAll = async () => {
    setSyncing(true);
    try {
      const res = await fetch(`${API_URL}/reports-v2/sync-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId: 'default' })
      });
      if (res.ok) {
        const result = await res.json();
        alert(`Synced ${result.synced} reports to Firebase!`);
      }
    } catch (error) {
      console.error('Sync failed:', error);
      alert('Sync failed. Please try again.');
    } finally {
      setSyncing(false);
    }
  };
  
  const filterReports = (list: ReportDefinition[]) => {
    return list.filter(r => 
      r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.description.toLowerCase().includes(searchQuery.toLowerCase())
    );
  };
  
  const totalCount = reports.printable.length + reports.combined.length + reports.sales.length + reports.employee.length;
  
  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-50">
        <RefreshCw className="w-8 h-8 text-emerald-500 animate-spin" />
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <header className="bg-white shadow-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button onClick={() => navigate('/backoffice/reports')} className="p-2 hover:bg-slate-100 rounded-lg transition">
                <ArrowLeft className="w-5 h-5 text-slate-600" />
              </button>
              <div>
                <h1 className="text-2xl font-bold text-slate-800">Reports Dashboard</h1>
                <p className="text-slate-500 text-sm">{totalCount} reports available</p>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search reports..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 pr-4 py-2 border border-slate-200 rounded-lg w-64 focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              
              <button
                onClick={handleSyncAll}
                disabled={syncing}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition flex items-center gap-2 disabled:opacity-50"
              >
                {syncing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                Sync to Firebase
              </button>
            </div>
          </div>
          
          {/* Category Tabs */}
          <div className="flex gap-2 mt-4">
            {[
              { key: 'all', label: 'All', count: totalCount, icon: BarChart3 },
              { key: 'combined', label: 'Combined', count: reports.combined.length, icon: Layers },
              { key: 'printable', label: 'Printable', count: reports.printable.length, icon: Printer },
              { key: 'sales', label: 'Sales', count: reports.sales.length, icon: DollarSign },
              { key: 'employee', label: 'Employee', count: reports.employee.length, icon: Users },
            ].filter(tab => tab.key === 'all' || tab.count > 0).map(tab => (
              <button
                key={tab.key}
                onClick={() => setSelectedCategory(tab.key as any)}
                className={`px-4 py-2 rounded-lg font-medium text-sm flex items-center gap-2 transition ${
                  selectedCategory === tab.key
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
                <span className={`px-1.5 py-0.5 rounded-full text-xs ${
                  selectedCategory === tab.key ? 'bg-white/20' : 'bg-slate-200'
                }`}>{tab.count}</span>
              </button>
            ))}
          </div>
        </div>
      </header>
      
      {/* Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Combined Reports */}
        {(selectedCategory === 'all' || selectedCategory === 'combined') && filterReports(reports.combined).length > 0 && (
          <section className="mb-8">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center">
                <Layers className="w-4 h-4 text-white" />
              </div>
              <h2 className="text-lg font-bold text-slate-800">Combined Reports</h2>
              <span className="text-slate-400 text-sm">Multiple sections in one view</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filterReports(reports.combined).map(report => (
                <ReportCard key={report.id} report={report} onClick={() => setSelectedReport(report)} />
              ))}
            </div>
          </section>
        )}
        
        {/* Printable Reports */}
        {(selectedCategory === 'all' || selectedCategory === 'printable') && filterReports(reports.printable).length > 0 && (
          <section className="mb-8">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 bg-amber-500 rounded-lg flex items-center justify-center">
                <Printer className="w-4 h-4 text-white" />
              </div>
              <h2 className="text-lg font-bold text-slate-800">Printable Reports</h2>
              <span className="text-slate-400 text-sm">For receipt printer</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {filterReports(reports.printable).map(report => (
                <ReportCard key={report.id} report={report} onClick={() => setSelectedReport(report)} />
              ))}
            </div>
          </section>
        )}
        
        {/* Sales Reports */}
        {(selectedCategory === 'all' || selectedCategory === 'sales') && filterReports(reports.sales).length > 0 && (
          <section className="mb-8">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center">
                <DollarSign className="w-4 h-4 text-white" />
              </div>
              <h2 className="text-lg font-bold text-slate-800">Sales Reports</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filterReports(reports.sales).map(report => (
                <ReportCard key={report.id} report={report} onClick={() => setSelectedReport(report)} />
              ))}
            </div>
          </section>
        )}
        
        {/* Employee Reports */}
        {(selectedCategory === 'all' || selectedCategory === 'employee') && filterReports(reports.employee).length > 0 && (
          <section className="mb-8">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 bg-purple-500 rounded-lg flex items-center justify-center">
                <Users className="w-4 h-4 text-white" />
              </div>
              <h2 className="text-lg font-bold text-slate-800">Employee Reports</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filterReports(reports.employee).map(report => (
                <ReportCard key={report.id} report={report} onClick={() => setSelectedReport(report)} />
              ))}
            </div>
          </section>
        )}
      </main>
      
      {/* Report Viewer Modal */}
      {selectedReport && (
        <ReportViewerModal report={selectedReport} onClose={() => setSelectedReport(null)} />
      )}
    </div>
  );
};

export default ReportsDashboardPage;
