import React, { useState, useEffect, useCallback } from 'react';
import { API_URL } from '../config/constants';

interface GiftCard {
  id: number;
  card_number: string;
  initial_amount: number;
  current_balance: number;
  used_amount: number;
  payment_method: string;
  customer_name: string;
  customer_phone: string;
  sold_by: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface Transaction {
  id: number;
  card_number: string;
  transaction_type: string;
  amount: number;
  balance_after: number;
  order_id: number | null;
  notes: string;
  created_at: string;
  customer_name: string;
  customer_phone: string;
}

interface Summary {
  total_cards: number;
  total_sold_amount: number;
  total_remaining_balance: number;
  total_used_amount: number;
  sales_total: number;
  reload_total: number;
  redeem_total: number;
}

const GiftCardReportPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'summary' | 'cards' | 'transactions'>('summary');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [cards, setCards] = useState<GiftCard[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [transactionType, setTransactionType] = useState('all');
  const [balanceFilter, setBalanceFilter] = useState('all');

  const formatCardNumber = (num: string) => {
    return num.replace(/(\d{4})/g, '$1 ').trim();
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      
      const res = await fetch(`${API_URL}/gift-cards/report/summary?${params}`);
      if (res.ok) {
        const data = await res.json();
        setSummary(data.summary);
      }
    } catch (error) {
      console.error('Error fetching summary:', error);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  const fetchCards = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (balanceFilter !== 'all') params.set('hasBalance', balanceFilter);
      
      const res = await fetch(`${API_URL}/gift-cards/report/cards?${params}`);
      if (res.ok) {
        const data = await res.json();
        setCards(data);
      }
    } catch (error) {
      console.error('Error fetching cards:', error);
    } finally {
      setLoading(false);
    }
  }, [balanceFilter]);

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      if (transactionType !== 'all') params.set('type', transactionType);
      
      const res = await fetch(`${API_URL}/gift-cards/report/transactions?${params}`);
      if (res.ok) {
        const data = await res.json();
        setTransactions(data);
      }
    } catch (error) {
      console.error('Error fetching transactions:', error);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, transactionType]);

  useEffect(() => {
    if (activeTab === 'summary') fetchSummary();
    else if (activeTab === 'cards') fetchCards();
    else if (activeTab === 'transactions') fetchTransactions();
  }, [activeTab, fetchSummary, fetchCards, fetchTransactions]);

  const getTransactionTypeColor = (type: string) => {
    switch (type) {
      case 'sale': return 'bg-green-100 text-green-800';
      case 'reload': return 'bg-blue-100 text-blue-800';
      case 'redeem': return 'bg-orange-100 text-orange-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getTransactionTypeLabel = (type: string) => {
    switch (type) {
      case 'sale': return 'Sale';
      case 'reload': return 'Reload';
      case 'redeem': return 'Used';
      default: return type;
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-500 to-amber-600 rounded-xl p-6 mb-6 shadow-lg">
          <h1 className="text-3xl font-bold text-white">🎁 Gift Card Report</h1>
          <p className="text-amber-100 mt-2">Gift card sales, usage, and balance tracking</p>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-xl shadow-lg mb-6">
          <div className="flex border-b">
            {[
              { key: 'summary', label: 'Summary', icon: '📊' },
              { key: 'cards', label: 'All Cards', icon: '💳' },
              { key: 'transactions', label: 'Transactions', icon: '📋' }
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as any)}
                className={`flex-1 py-4 px-6 text-center font-semibold transition-all ${
                  activeTab === tab.key
                    ? 'bg-amber-50 text-amber-600 border-b-2 border-amber-500'
                    : 'text-gray-500 hover:bg-gray-50'
                }`}
              >
                <span className="mr-2">{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>

          {/* Filters */}
          <div className="p-4 bg-gray-50 border-b flex gap-4 flex-wrap items-end">
            {(activeTab === 'summary' || activeTab === 'transactions') && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Start Date</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="px-3 py-2 border rounded-lg focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">End Date</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="px-3 py-2 border rounded-lg focus:outline-none focus:border-amber-500"
                  />
                </div>
              </>
            )}
            {activeTab === 'transactions' && (
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Type</label>
                <select
                  value={transactionType}
                  onChange={(e) => setTransactionType(e.target.value)}
                  className="px-3 py-2 border rounded-lg focus:outline-none focus:border-amber-500"
                >
                  <option value="all">All</option>
                  <option value="sale">Sale</option>
                  <option value="reload">Reload</option>
                  <option value="redeem">Used</option>
                </select>
              </div>
            )}
            {activeTab === 'cards' && (
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Balance</label>
                <select
                  value={balanceFilter}
                  onChange={(e) => setBalanceFilter(e.target.value)}
                  className="px-3 py-2 border rounded-lg focus:outline-none focus:border-amber-500"
                >
                  <option value="all">All Cards</option>
                  <option value="true">Has Balance</option>
                  <option value="false">Zero Balance</option>
                </select>
              </div>
            )}
            <button
              onClick={() => {
                if (activeTab === 'summary') fetchSummary();
                else if (activeTab === 'cards') fetchCards();
                else fetchTransactions();
              }}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-lg transition-all"
            >
              Search
            </button>
          </div>

          {/* Content */}
          <div className="p-6">
            {loading ? (
              <div className="text-center py-10 text-gray-500">Loading...</div>
            ) : (
              <>
                {/* Summary Tab */}
                {activeTab === 'summary' && summary && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-blue-50 rounded-xl p-4 text-center">
                      <div className="text-3xl font-bold text-blue-600">{summary.total_cards}</div>
                      <div className="text-sm text-blue-500 mt-1">Total Cards</div>
                    </div>
                    <div className="bg-green-50 rounded-xl p-4 text-center">
                      <div className="text-3xl font-bold text-green-600">${summary.sales_total.toFixed(2)}</div>
                      <div className="text-sm text-green-500 mt-1">Total Sales</div>
                    </div>
                    <div className="bg-blue-50 rounded-xl p-4 text-center">
                      <div className="text-3xl font-bold text-blue-600">${summary.reload_total.toFixed(2)}</div>
                      <div className="text-sm text-blue-500 mt-1">Total Reload</div>
                    </div>
                    <div className="bg-orange-50 rounded-xl p-4 text-center">
                      <div className="text-3xl font-bold text-orange-600">${summary.redeem_total.toFixed(2)}</div>
                      <div className="text-sm text-orange-500 mt-1">Total Used</div>
                    </div>
                    <div className="bg-purple-50 rounded-xl p-4 text-center col-span-2">
                      <div className="text-3xl font-bold text-purple-600">${summary.total_remaining_balance.toFixed(2)}</div>
                      <div className="text-sm text-purple-500 mt-1">Total Remaining Balance (Liability)</div>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-4 text-center col-span-2">
                      <div className="text-3xl font-bold text-gray-600">${(summary.sales_total + summary.reload_total).toFixed(2)}</div>
                      <div className="text-sm text-gray-500 mt-1">Total Received (Sales + Reload)</div>
                    </div>
                  </div>
                )}

                {/* Cards Tab */}
                {activeTab === 'cards' && (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-100">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Card Number</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Customer</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600">Initial</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600">Used</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600">Balance</th>
                          <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600">Status</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Created</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {cards.map((card) => (
                          <tr key={card.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 font-mono text-sm">{formatCardNumber(card.card_number)}</td>
                            <td className="px-4 py-3">
                              <div className="text-sm font-medium">{card.customer_name || '-'}</div>
                              <div className="text-xs text-gray-500">{card.customer_phone || ''}</div>
                            </td>
                            <td className="px-4 py-3 text-right text-sm">${card.initial_amount.toFixed(2)}</td>
                            <td className="px-4 py-3 text-right text-sm text-orange-600">${card.used_amount.toFixed(2)}</td>
                            <td className="px-4 py-3 text-right text-sm font-bold text-green-600">${card.current_balance.toFixed(2)}</td>
                            <td className="px-4 py-3 text-center">
                              <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                                card.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                              }`}>
                                {card.status}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-xs text-gray-500">{formatDate(card.created_at)}</td>
                          </tr>
                        ))}
                        {cards.length === 0 && (
                          <tr>
                            <td colSpan={7} className="px-4 py-10 text-center text-gray-500">No cards found</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Transactions Tab */}
                {activeTab === 'transactions' && (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-100">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Date</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Card Number</th>
                          <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600">Type</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600">Amount</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600">Balance After</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Customer</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Notes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {transactions.map((tx) => (
                          <tr key={tx.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-xs text-gray-500">{formatDate(tx.created_at)}</td>
                            <td className="px-4 py-3 font-mono text-sm">{formatCardNumber(tx.card_number)}</td>
                            <td className="px-4 py-3 text-center">
                              <span className={`px-2 py-1 rounded-full text-xs font-semibold ${getTransactionTypeColor(tx.transaction_type)}`}>
                                {getTransactionTypeLabel(tx.transaction_type)}
                              </span>
                            </td>
                            <td className={`px-4 py-3 text-right text-sm font-bold ${
                              tx.amount >= 0 ? 'text-green-600' : 'text-orange-600'
                            }`}>
                              {tx.amount >= 0 ? '+' : ''}${Math.abs(tx.amount).toFixed(2)}
                            </td>
                            <td className="px-4 py-3 text-right text-sm">${tx.balance_after.toFixed(2)}</td>
                            <td className="px-4 py-3">
                              <div className="text-sm">{tx.customer_name || '-'}</div>
                            </td>
                            <td className="px-4 py-3 text-xs text-gray-500 max-w-[200px] truncate">{tx.notes || '-'}</td>
                          </tr>
                        ))}
                        {transactions.length === 0 && (
                          <tr>
                            <td colSpan={7} className="px-4 py-10 text-center text-gray-500">No transactions found</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default GiftCardReportPage;



