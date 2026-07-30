import React, { useEffect, useState } from 'react';
import styles from './PipelinePage.module.css';
import { Plus, ChevronRight, ChevronLeft, Trash2, Trophy, Frown, X } from 'lucide-react';
import { pipelineApi } from '../../lib/api';
import type { Deal, Stage } from '../../lib/api';
import { useAuth } from '../../lib/AuthContext';

export const PipelinePage = () => {
  const { user } = useAuth();
  const isAdmin = Boolean(
    user?.is_superuser || 
    user?.role === 'Admin' || 
    user?.role === 'Owner' || 
    (user?.role || '').toString().toLowerCase() === 'admin'
  );
  const [stages, setStages] = useState<Stage[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [value, setValue] = useState(0);
  const [stageId, setStageId] = useState('');

  const fetchData = async (isSilent = false) => {
    if (!isSilent && stages.length === 0) {
      setLoading(true);
    }
    try {
      const [pipelines, fetchedDeals] = await Promise.all([
        pipelineApi.getPipelines(),
        pipelineApi.getDeals()
      ]);
      setDeals(fetchedDeals);

      if (pipelines.length > 0) {
        const salesPipeline = pipelines[0];
        const fetchedStages = await pipelineApi.getStages(salesPipeline.id);
        setStages(fetchedStages);
        if (fetchedStages.length > 0 && !stageId) {
          setStageId(fetchedStages[0].id);
        }
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Load data on mount and poll for real-time deals updates
  useEffect(() => {
    fetchData();
    const interval = setInterval(() => {
      pipelineApi.getDeals()
        .then(fetchedDeals => {
          setDeals(fetchedDeals);
        })
        .catch(e => console.error("Pipeline deals polling failed:", e));
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  const openAddModal = () => {
    setTitle('');
    setValue(0);
    if (stages.length > 0) setStageId(stages[0].id);
    setIsModalOpen(true);
  };

  const handleCreateDeal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !stageId) return;

    try {
      await pipelineApi.createDeal({
        title,
        value: Number(value),
        stage_id: stageId,
        status: 'Open'
      });
      setIsModalOpen(false);
      fetchData(true);
    } catch (err: any) {
      alert(err.message || 'Failed to create deal');
    }
  };

  const moveDeal = async (deal: Deal, direction: 'forward' | 'backward') => {
    const currentStageIndex = stages.findIndex(s => s.id === deal.stage_id);
    if (currentStageIndex === -1) return;

    let nextIndex = currentStageIndex + (direction === 'forward' ? 1 : -1);
    if (nextIndex < 0 || nextIndex >= stages.length) return;

    const nextStage = stages[nextIndex];
    
    // Automatically set status to Won if moved to "Won", or Lost if moved to "Lost", otherwise "Open"
    let status = 'Open';
    if (nextStage.name.toLowerCase().includes('won')) {
      status = 'Won';
    } else if (nextStage.name.toLowerCase().includes('lost')) {
      status = 'Lost';
    }

    try {
      await pipelineApi.updateDeal(deal.id, { 
        stage_id: nextStage.id,
        status: status
      });
      // Optimistic update
      setDeals(prev => prev.map(d => d.id === deal.id ? { ...d, stage_id: nextStage.id, status } : d));
    } catch (err: any) {
      alert(err.message || 'Failed to move deal');
    }
  };

  const handleUpdateStatus = async (deal: Deal, status: 'Won' | 'Lost' | 'Open') => {
    try {
      await pipelineApi.updateDeal(deal.id, { status });
      setDeals(prev => prev.map(d => d.id === deal.id ? { ...d, status } : d));
    } catch (err: any) {
      alert(err.message || 'Failed to update deal status');
    }
  };

  const handleDeleteDeal = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this deal?')) return;
    try {
      await pipelineApi.deleteDeal(id);
      fetchData();
    } catch (err: any) {
      alert(err.message || 'Failed to delete deal');
    }
  };


  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Deals Pipeline</h1>
          <p className={styles.subtitle}>Track deal flow, contract values, and conversion stages.</p>
        </div>
        <button className={styles.addBtn} onClick={openAddModal}>
          <Plus size={18} />
          Create Deal
        </button>
      </div>

      {loading && <div className={styles.stateMsg}>Loading pipeline board…</div>}
      {error && <div className={styles.errorMsg}>Error: {error}</div>}

      {!loading && !error && (
        <div className={styles.board}>
          {stages.map(stage => {
            const stageDeals = deals.filter(d => d.stage_id === stage.id);
            const totalValue = stageDeals.reduce((sum, d) => sum + (d.value ?? 0), 0);

            return (
              <div key={stage.id} className={styles.column}>
                <div className={styles.columnHeader}>
                  <div>
                    <h3 className={styles.columnTitle}>{stage.name}</h3>
                    <span className={styles.dealCount}>{stageDeals.length} deals</span>
                  </div>
                  <span className={styles.totalVal}>
                    ${totalValue.toLocaleString(undefined, { minimumFractionDigits: 0 })}
                  </span>
                </div>

                <div className={styles.cardsList}>
                  {stageDeals.length === 0 && (
                    <div className={styles.emptyColMsg}>Drop deals here</div>
                  )}
                  {stageDeals.map(deal => (
                    <div key={deal.id} className={`${styles.dealCard} ${
                      deal.status === 'Won' ? styles.cardWon :
                      deal.status === 'Lost' ? styles.cardLost : ''
                    }`}>
                      <div className={styles.cardHeader}>
                        <span className={styles.dealTitle}>{deal.title}</span>
                        {isAdmin && (
                          <button className={styles.deleteBtn} onClick={() => handleDeleteDeal(deal.id)} title="Delete">
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>

                      <div className={styles.cardValue}>
                        ${(deal.value ?? 0).toLocaleString()}
                      </div>


                      <div className={styles.cardFooter}>
                        <div className={styles.statusButtons}>
                          {deal.status === 'Open' ? (
                            <>
                              <button className={styles.statusBtnWon} onClick={() => handleUpdateStatus(deal, 'Won')} title="Mark Won">
                                <Trophy size={12} />
                              </button>
                              <button className={styles.statusBtnLost} onClick={() => handleUpdateStatus(deal, 'Lost')} title="Mark Lost">
                                <Frown size={12} />
                              </button>
                            </>
                          ) : (
                            <span className={deal.status === 'Won' ? styles.badgeWon : styles.badgeLost}>
                              {deal.status}
                            </span>
                          )}
                        </div>

                        <div className={styles.navButtons}>
                          <button
                            disabled={stages.indexOf(stage) === 0}
                            onClick={() => moveDeal(deal, 'backward')}
                            className={styles.navBtn}
                          >
                            <ChevronLeft size={14} />
                          </button>
                          <button
                            disabled={stages.indexOf(stage) === stages.length - 1}
                            onClick={() => moveDeal(deal, 'forward')}
                            className={styles.navBtn}
                          >
                            <ChevronRight size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Deal Modal */}
      {isModalOpen && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h2>Create New Deal</h2>
              <button className={styles.closeBtn} onClick={() => setIsModalOpen(false)}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleCreateDeal} className={styles.form}>
              <div className={styles.formGroup}>
                <label>Deal Title *</label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="e.g. Acme Corp Enterprise Contract"
                />
              </div>

              <div className={styles.formGroup}>
                <label>Deal Value ($) *</label>
                <input
                  type="number"
                  required
                  min="0"
                  value={value}
                  onChange={e => setValue(Number(e.target.value))}
                />
              </div>

              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label>Initial Pipeline Stage</label>
                  <select value={stageId} onChange={e => setStageId(e.target.value)}>
                    {stages.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className={styles.formActions}>
                <button type="button" className={styles.cancelBtn} onClick={() => setIsModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className={styles.submitBtn}>
                  Create Deal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
