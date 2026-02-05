import React, { useState, useEffect, useCallback } from 'react';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3177/api';

// 카테고리별 색상
const CATEGORY_COLORS = ['#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#00C49F', '#0088FE', '#FF8042', '#A569BD', '#48C9B0', '#F39C12'];

// 레포트 정의 타입
interface ReportDefinition {
  id: string;
  name: string;
  category: string;
  type: 'text' | 'graph';
  chartType?: string;
  description: string;
  printable?: boolean;
}

interface ReportData {
  report: ReportDefinition;
  dateRange: { start: string; end: string };
  generatedAt: string;
  data: any;
}

const ReportManagerPage: React.FC = () => {
  // 상태 관리
  const [reports, setReports] = useState<ReportDefinition[]>([]);
  const [selectedReport, setSelectedReport] = useState<ReportDefinition | null>(null);
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingReports, setLoadingReports] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [dateRange, setDateRange] = useState({
    startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0]
  });
  const [error, setError] = useState<string | null>(null);

  // 레포트 목록 가져오기
  useEffect(() => {
    const fetchReports = async () => {
      try {
        setLoadingReports(true);
        const res = await fetch(`${API_URL}/reports`);
        const data = await res.json();
        if (data.reports) {
          setReports(data.reports);
        }
      } catch (err) {
        console.error('Failed to fetch reports:', err);
        setError('레포트 목록을 불러오는데 실패했습니다.');
      } finally {
        setLoadingReports(false);
      }
    };
    fetchReports();
  }, []);

  // 레포트 데이터 가져오기
  const fetchReportData = useCallback(async (report: ReportDefinition) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_URL}/reports/${report.id}?startDate=${dateRange.startDate}&endDate=${dateRange.endDate}`
      );
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setReportData(null);
      } else {
        setReportData(data);
      }
    } catch (err) {
      console.error('Failed to fetch report data:', err);
      setError('레포트 데이터를 불러오는데 실패했습니다.');
      setReportData(null);
    } finally {
      setLoading(false);
    }
  }, [dateRange]);

  // 레포트 선택 시 데이터 가져오기
  useEffect(() => {
    if (selectedReport) {
      fetchReportData(selectedReport);
    }
  }, [selectedReport, fetchReportData]);

  // 카테고리 필터링
  const filteredReports = selectedCategory === 'all'
    ? reports
    : reports.filter(r => r.category === selectedCategory);

  // 그룹별 레포트 수
  const salesReports = reports.filter(r => r.category === 'sales');
  const employeeReports = reports.filter(r => r.category === 'employee');
  const printableReports = reports.filter(r => r.printable);

  // 차트 렌더링
  const renderChart = () => {
    if (!reportData || !reportData.data) return null;
    const { chartData, summary, total, details } = reportData.data;
    const chartType = selectedReport?.chartType || 'bar';

    if (!chartData || chartData.length === 0) {
      return (
        <div className="flex items-center justify-center h-64 text-gray-500">
          해당 기간에 데이터가 없습니다.
        </div>
      );
    }

    // 데이터 키 추출
    const dataKeys = chartData.length > 0
      ? Object.keys(chartData[0]).filter(k => typeof chartData[0][k] === 'number' && !['hour', 'dayOfWeek'].includes(k))
      : [];

    switch (chartType) {
      case 'line':
        return (
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={chartData[0]?.date ? 'date' : (chartData[0]?.label || 'name')} />
              <YAxis />
              <Tooltip formatter={(value: number) => typeof value === 'number' ? `$${value.toFixed(2)}` : value} />
              <Legend />
              {dataKeys.slice(0, 3).map((key, idx) => (
                <Line key={key} type="monotone" dataKey={key} stroke={CATEGORY_COLORS[idx]} strokeWidth={2} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        );

      case 'area':
      case 'stacked-area':
        return (
          <ResponsiveContainer width="100%" height={400}>
            <AreaChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={chartData[0]?.date ? 'date' : (chartData[0]?.label || 'name')} />
              <YAxis />
              <Tooltip formatter={(value: number) => typeof value === 'number' ? `$${value.toFixed(2)}` : value} />
              <Legend />
              {dataKeys.slice(0, 3).map((key, idx) => (
                <Area key={key} type="monotone" dataKey={key} stackId={chartType === 'stacked-area' ? '1' : undefined} stroke={CATEGORY_COLORS[idx]} fill={CATEGORY_COLORS[idx]} fillOpacity={0.6} />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        );

      case 'pie':
      case 'donut':
        return (
          <ResponsiveContainer width="100%" height={400}>
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={chartType === 'donut' ? 60 : 0}
                outerRadius={120}
                fill="#8884d8"
                dataKey="revenue"
                nameKey={chartData[0]?.category ? 'category' : (chartData[0]?.method ? 'method' : 'source')}
                label={({ name, percentage }) => `${name}: ${percentage}%`}
              >
                {chartData.map((entry: any, index: number) => (
                  <Cell key={`cell-${index}`} fill={entry.fill || CATEGORY_COLORS[index % CATEGORY_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value: number) => `$${value.toFixed(2)}`} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        );

      case 'horizontal-bar':
        return (
          <ResponsiveContainer width="100%" height={Math.max(400, chartData.length * 40)}>
            <BarChart data={chartData} layout="vertical" margin={{ top: 20, right: 30, left: 100, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis type="category" dataKey={chartData[0]?.item_name ? 'item_name' : 'name'} width={90} />
              <Tooltip formatter={(value: number) => typeof value === 'number' && (value > 10 || value === Math.floor(value)) ? value : `$${value.toFixed(2)}`} />
              <Legend />
              <Bar dataKey="quantity" fill="#8884d8" name="수량" />
              <Bar dataKey="revenue" fill="#82ca9d" name="매출" />
            </BarChart>
          </ResponsiveContainer>
        );

      case 'stacked-bar':
      case 'grouped-bar':
        return (
          <ResponsiveContainer width="100%" height={400}>
            <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={chartData[0]?.date ? 'date' : (chartData[0]?.label || chartData[0]?.month || 'name')} />
              <YAxis />
              <Tooltip formatter={(value: number) => typeof value === 'number' ? `$${value.toFixed(2)}` : value} />
              <Legend />
              {dataKeys.slice(0, 4).map((key, idx) => (
                <Bar key={key} dataKey={key} stackId={chartType === 'stacked-bar' ? 'stack' : undefined} fill={CATEGORY_COLORS[idx]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        );

      case 'bar':
      default:
        return (
          <ResponsiveContainer width="100%" height={400}>
            <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={chartData[0]?.label || chartData[0]?.date || chartData[0]?.hour?.toString() || 'name'} />
              <YAxis />
              <Tooltip formatter={(value: number) => typeof value === 'number' && value < 1000 && value !== Math.floor(value) ? `$${value.toFixed(2)}` : value.toLocaleString()} />
              <Legend />
              {dataKeys.includes('revenue') && <Bar dataKey="revenue" fill="#8884d8" name="매출" />}
              {dataKeys.includes('orders') && <Bar dataKey="orders" fill="#82ca9d" name="주문수" />}
              {dataKeys.includes('count') && !dataKeys.includes('orders') && <Bar dataKey="count" fill="#82ca9d" name="건수" />}
              {dataKeys.includes('amount') && !dataKeys.includes('revenue') && <Bar dataKey="amount" fill="#8884d8" name="금액" />}
              {dataKeys.includes('total_tips') && <Bar dataKey="total_tips" fill="#ffc658" name="팁" />}
              {dataKeys.includes('quantity') && <Bar dataKey="quantity" fill="#ff7300" name="수량" />}
              {!dataKeys.includes('revenue') && !dataKeys.includes('orders') && !dataKeys.includes('count') && !dataKeys.includes('amount') && dataKeys.slice(0, 2).map((key, idx) => (
                <Bar key={key} dataKey={key} fill={CATEGORY_COLORS[idx]} name={key} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        );
    }
  };

  // 텍스트 레포트 렌더링 (프린터용)
  const renderTextReport = () => {
    if (!reportData || !reportData.data) return null;
    const { data } = reportData;

    return (
      <div className="bg-gray-900 text-green-400 font-mono p-4 rounded-lg overflow-auto max-h-[500px]">
        <pre className="whitespace-pre-wrap text-sm">
          {/* Daily Cash Report */}
          {selectedReport?.id === 'daily-cash-report' && (
            <>
              {'═'.repeat(42)}{'\n'}
              {'          DAILY CASH REPORT\n'}
              {`           ${data.date}\n`}
              {'═'.repeat(42)}{'\n\n'}
              {'         [ CASH DRAWER ]\n'}
              {'-'.repeat(42)}{'\n'}
              {`Opening Cash:                   $${(data.openingCash || 0).toFixed(2)}\n`}
              {`Cash Sales:                     $${(data.cashSales || 0).toFixed(2)}\n`}
              {`Cash Tips:                      $${(data.cashTips || 0).toFixed(2)}\n`}
              {'-'.repeat(42)}{'\n'}
              {`Expected Cash:                  $${(data.expectedCash || 0).toFixed(2)}\n`}
              {`Actual Closing:                 $${(data.closingCash || 0).toFixed(2)}\n`}
              {`Variance:                       $${(data.variance || 0).toFixed(2)}\n\n`}
              {'         [ SALES SUMMARY ]\n'}
              {'-'.repeat(42)}{'\n'}
              {`Cash Sales:                     $${(data.cashSales || 0).toFixed(2)}\n`}
              {`Card Sales:                     $${(data.cardSales || 0).toFixed(2)}\n`}
              {'-'.repeat(42)}{'\n'}
              {`TOTAL SALES:                    $${(data.totalSales || 0).toFixed(2)}\n\n`}
              {'            [ TIPS ]\n'}
              {'-'.repeat(42)}{'\n'}
              {`Cash Tips:                      $${(data.cashTips || 0).toFixed(2)}\n`}
              {`Card Tips:                      $${(data.cardTips || 0).toFixed(2)}\n`}
              {'-'.repeat(42)}{'\n'}
              {`TOTAL TIPS:                     $${(data.totalTips || 0).toFixed(2)}\n\n`}
              {`Transactions:                   ${data.transactionCount || 0}\n`}
              {'═'.repeat(42)}{'\n'}
            </>
          )}

          {/* Daily Summary Report */}
          {selectedReport?.id === 'daily-summary-report' && (
            <>
              {'═'.repeat(42)}{'\n'}
              {'        DAILY SUMMARY REPORT\n'}
              {`           ${data.date}\n`}
              {'═'.repeat(42)}{'\n\n'}
              {'         [ SALES SUMMARY ]\n'}
              {'-'.repeat(42)}{'\n'}
              {`Total Orders:                   ${data.sales?.order_count || 0}\n`}
              {`Total Guests:                   ${data.guests || 0}\n`}
              {`Avg Check:                      $${(data.sales?.avg_check || 0).toFixed(2)}\n\n`}
              {`Subtotal:                       $${(data.sales?.subtotal || 0).toFixed(2)}\n`}
              {`Discounts:                     -$${(data.sales?.discounts || 0).toFixed(2)}\n`}
              {`Tax:                            $${(data.sales?.tax || 0).toFixed(2)}\n`}
              {'-'.repeat(42)}{'\n'}
              {`NET SALES:                      $${(data.sales?.total || 0).toFixed(2)}\n`}
              {`Tips:                           $${(data.tips || 0).toFixed(2)}\n`}
              {'═'.repeat(42)}{'\n'}
              {`GRAND TOTAL:                    $${((data.sales?.total || 0) + (data.tips || 0)).toFixed(2)}\n\n`}
              {'       [ PAYMENT BREAKDOWN ]\n'}
              {'-'.repeat(42)}{'\n'}
              {data.payments?.map((p: any) => `${p.payment_method} (${p.count}):${' '.repeat(Math.max(1, 30 - p.payment_method.length - p.count.toString().length - 3))}$${(p.amount || 0).toFixed(2)}\n`).join('')}
              {'\n'}
              {'        [ VOIDS & REFUNDS ]\n'}
              {'-'.repeat(42)}{'\n'}
              {`Voids (${data.voids?.count || 0}):                       $${(data.voids?.amount || 0).toFixed(2)}\n`}
              {`Refunds (${data.refunds?.count || 0}):                     $${(data.refunds?.amount || 0).toFixed(2)}\n`}
              {'═'.repeat(42)}{'\n'}
            </>
          )}

          {/* Shift Close Report */}
          {selectedReport?.id === 'shift-close-report' && (
            <>
              {'═'.repeat(42)}{'\n'}
              {'        SHIFT CLOSE REPORT\n'}
              {'═'.repeat(42)}{'\n\n'}
              {`Employee:                       ${data.employeeName || 'All Staff'}\n`}
              {`Date:                           ${data.date || '-'}\n`}
              {`Shift Start:                    ${data.startedAt ? new Date(data.startedAt).toLocaleTimeString() : 'N/A'}\n`}
              {`Shift End:                      ${data.endedAt ? new Date(data.endedAt).toLocaleTimeString() : 'N/A'}\n\n`}
              {'         [ CASH DRAWER ]\n'}
              {'-'.repeat(42)}{'\n'}
              {`Opening Cash:                   $${(data.openingCash || 0).toFixed(2)}\n`}
              {`(+) Cash Collected:             $${(data.cashCollected || 0).toFixed(2)}\n`}
              {'-'.repeat(42)}{'\n'}
              {`Expected Cash:                  $${(data.expectedCash || 0).toFixed(2)}\n`}
              {`Actual Closing:                 $${(data.closingCash || 0).toFixed(2)}\n`}
              {`Variance:                       $${(data.variance || 0).toFixed(2)}\n\n`}
              {'         [ SALES SUMMARY ]\n'}
              {'-'.repeat(42)}{'\n'}
              {`Orders:                         ${data.orderCount || 0}\n`}
              {`Cash Sales:                     $${(data.cashCollected || 0).toFixed(2)}\n`}
              {`Card Sales:                     $${(data.cardCollected || 0).toFixed(2)}\n`}
              {'-'.repeat(42)}{'\n'}
              {`TOTAL SALES:                    $${(data.totalSales || 0).toFixed(2)}\n`}
              {`Tips Collected:                 $${(data.tipsCollected || 0).toFixed(2)}\n`}
              {'═'.repeat(42)}{'\n'}
            </>
          )}

          {/* Generic data display */}
          {!['daily-cash-report', 'daily-summary-report', 'shift-close-report'].includes(selectedReport?.id || '') && (
            <>{JSON.stringify(data, null, 2)}</>
          )}
        </pre>
      </div>
    );
  };

  // Summary Cards 렌더링
  const renderSummaryCards = () => {
    if (!reportData || !reportData.data || !reportData.data.summary) return null;
    const { summary } = reportData.data;

    const summaryItems = Object.entries(summary).map(([key, value]) => {
      const displayName = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
      const displayValue = typeof value === 'number'
        ? (key.toLowerCase().includes('revenue') || key.toLowerCase().includes('sales') || key.toLowerCase().includes('tip') || key.toLowerCase().includes('amount') || key.toLowerCase().includes('check') || key.toLowerCase().includes('average'))
          ? `$${value.toFixed(2)}`
          : value.toLocaleString()
        : typeof value === 'object' && value !== null
          ? (value as any).label || (value as any).name || JSON.stringify(value)
          : String(value);

      return { key, displayName, displayValue };
    });

    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {summaryItems.slice(0, 4).map(({ key, displayName, displayValue }) => (
          <div key={key} className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
            <div className="text-sm text-gray-500">{displayName}</div>
            <div className="text-xl font-bold text-gray-800">{displayValue}</div>
          </div>
        ))}
      </div>
    );
  };

  // 프린트 버튼 핸들러
  const handlePrint = async () => {
    if (!selectedReport?.printable) return;
    try {
      const res = await fetch(`${API_URL}/reports/${selectedReport.id}/print?startDate=${dateRange.startDate}&width=42`);
      const text = await res.text();
      
      // 새 창에서 프린트
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(`
          <html>
            <head><title>${selectedReport.name}</title></head>
            <body style="font-family: monospace; white-space: pre;">
              ${text}
            </body>
          </html>
        `);
        printWindow.document.close();
        printWindow.print();
      }
    } catch (err) {
      console.error('Print error:', err);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      {/* 헤더 */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-800">Report Manager</h1>
        <p className="text-gray-600">실제 영업 데이터를 기반으로 다양한 레포트를 조회합니다.</p>
      </div>

      {/* 통계 요약 */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg p-4 shadow">
          <div className="text-sm opacity-80">전체 레포트</div>
          <div className="text-2xl font-bold">{reports.length}</div>
        </div>
        <div className="bg-gradient-to-r from-green-500 to-green-600 text-white rounded-lg p-4 shadow">
          <div className="text-sm opacity-80">매출 레포트</div>
          <div className="text-2xl font-bold">{salesReports.length}</div>
        </div>
        <div className="bg-gradient-to-r from-purple-500 to-purple-600 text-white rounded-lg p-4 shadow">
          <div className="text-sm opacity-80">직원 레포트</div>
          <div className="text-2xl font-bold">{employeeReports.length}</div>
        </div>
        <div className="bg-gradient-to-r from-orange-500 to-orange-600 text-white rounded-lg p-4 shadow">
          <div className="text-sm opacity-80">프린터 레포트</div>
          <div className="text-2xl font-bold">{printableReports.length}</div>
        </div>
      </div>

      <div className="flex gap-6">
        {/* 사이드바 - 레포트 목록 */}
        <div className="w-80 flex-shrink-0">
          <div className="bg-white rounded-lg shadow-md p-4">
            {/* 날짜 선택 */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">조회 기간</label>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={dateRange.startDate}
                  onChange={(e) => setDateRange(prev => ({ ...prev, startDate: e.target.value }))}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm"
                />
                <span className="text-gray-500 self-center">~</span>
                <input
                  type="date"
                  value={dateRange.endDate}
                  onChange={(e) => setDateRange(prev => ({ ...prev, endDate: e.target.value }))}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm"
                />
              </div>
            </div>

            {/* 빠른 기간 선택 */}
            <div className="mb-4 flex flex-wrap gap-2">
              {[
                { label: '오늘', days: 0 },
                { label: '어제', days: 1 },
                { label: '7일', days: 7 },
                { label: '30일', days: 30 },
                { label: '90일', days: 90 }
              ].map(({ label, days }) => (
                <button
                  key={label}
                  onClick={() => {
                    const end = days === 1 ? new Date(Date.now() - 24 * 60 * 60 * 1000) : new Date();
                    const start = new Date(end.getTime() - (days === 1 ? 0 : days) * 24 * 60 * 60 * 1000);
                    setDateRange({
                      startDate: start.toISOString().split('T')[0],
                      endDate: end.toISOString().split('T')[0]
                    });
                  }}
                  className="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded transition"
                >
                  {label}
                </button>
              ))}
            </div>

            {/* 카테고리 필터 */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">카테고리</label>
              <div className="flex gap-2 flex-wrap">
                {['all', 'sales', 'employee'].map(cat => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-3 py-1 rounded text-sm transition ${
                      selectedCategory === cat
                        ? 'bg-blue-500 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {cat === 'all' ? '전체' : cat === 'sales' ? '매출' : '직원'}
                  </button>
                ))}
              </div>
            </div>

            {/* 레포트 목록 */}
            <div className="max-h-[500px] overflow-y-auto">
              {loadingReports ? (
                <div className="text-center py-4 text-gray-500">로딩 중...</div>
              ) : (
                <div className="space-y-1">
                  {filteredReports.map(report => (
                    <button
                      key={report.id}
                      onClick={() => setSelectedReport(report)}
                      className={`w-full text-left px-3 py-2 rounded transition ${
                        selectedReport?.id === report.id
                          ? 'bg-blue-500 text-white'
                          : 'hover:bg-gray-100'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {report.printable && (
                          <span className="text-xs">🖨️</span>
                        )}
                        <span className="text-sm font-medium truncate">{report.name}</span>
                      </div>
                      <div className={`text-xs truncate ${
                        selectedReport?.id === report.id ? 'text-blue-100' : 'text-gray-500'
                      }`}>
                        {report.description}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 메인 컨텐츠 - 레포트 데이터 */}
        <div className="flex-1">
          {!selectedReport ? (
            <div className="bg-white rounded-lg shadow-md p-8 text-center">
              <div className="text-6xl mb-4">📊</div>
              <h2 className="text-xl font-semibold text-gray-700 mb-2">레포트를 선택하세요</h2>
              <p className="text-gray-500">왼쪽 목록에서 조회할 레포트를 선택하면 데이터가 표시됩니다.</p>
            </div>
          ) : loading ? (
            <div className="bg-white rounded-lg shadow-md p-8 text-center">
              <div className="animate-spin text-4xl mb-4">⏳</div>
              <p className="text-gray-500">데이터를 불러오는 중...</p>
            </div>
          ) : error ? (
            <div className="bg-white rounded-lg shadow-md p-8 text-center">
              <div className="text-4xl mb-4">⚠️</div>
              <p className="text-red-500">{error}</p>
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow-md p-6">
              {/* 레포트 헤더 */}
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h2 className="text-2xl font-bold text-gray-800">{selectedReport.name}</h2>
                  <p className="text-gray-500">{selectedReport.description}</p>
                  <div className="flex gap-2 mt-2">
                    <span className="px-2 py-1 bg-gray-100 rounded text-xs text-gray-600">
                      {reportData?.dateRange.start} ~ {reportData?.dateRange.end}
                    </span>
                    <span className="px-2 py-1 bg-blue-100 rounded text-xs text-blue-600">
                      {selectedReport.type === 'text' ? '텍스트' : selectedReport.chartType || '그래프'}
                    </span>
                  </div>
                </div>
                {selectedReport.printable && (
                  <button
                    onClick={handlePrint}
                    className="px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-700 transition flex items-center gap-2"
                  >
                    🖨️ 프린트
                  </button>
                )}
              </div>

              {/* Summary Cards */}
              {renderSummaryCards()}

              {/* 차트 또는 텍스트 레포트 */}
              {selectedReport.type === 'text' ? renderTextReport() : renderChart()}

              {/* 생성 시간 */}
              {reportData && (
                <div className="mt-4 text-right text-xs text-gray-400">
                  Generated at: {new Date(reportData.generatedAt).toLocaleString()}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ReportManagerPage;
