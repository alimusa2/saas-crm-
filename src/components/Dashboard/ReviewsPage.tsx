import React, { useState, useEffect } from 'react';
import styles from './ReviewsPage.module.css';
import { reviewsApi } from '../../lib/api';
import type { Review } from '../../lib/api';
import { Plus, Star, Trash2, CheckCircle, X } from 'lucide-react';

const StarRating = ({ rating }: { rating: number }) => (
  <div className={styles.stars}>
    {[1, 2, 3, 4, 5].map(s => (
      <Star key={s} size={16} fill={s <= rating ? '#F59E0B' : 'none'} color={s <= rating ? '#F59E0B' : '#D1D5DB'} />
    ))}
  </div>
);

export const ReviewsPage = () => {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newReview, setNewReview] = useState({ reviewer_name: '', reviewer_email: '', rating: 5, title: '', content: '', source: 'Manual' });

  useEffect(() => { fetchReviews(); }, []);

  const fetchReviews = async () => {
    setLoading(true);
    try {
      const data = await reviewsApi.getReviews();
      setReviews(data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const created = await reviewsApi.createReview(newReview);
      setReviews([created, ...reviews]);
      setIsModalOpen(false);
      setNewReview({ reviewer_name: '', reviewer_email: '', rating: 5, title: '', content: '', source: 'Manual' });
    } catch (e) { console.error(e); }
  };

  const handleApprove = async (review: Review) => {
    try {
      const updated = await reviewsApi.updateReview(review.id, { status: 'Approved' });
      setReviews(reviews.map(r => r.id === updated.id ? updated : r));
    } catch (e) { console.error(e); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this review?')) return;
    try {
      await reviewsApi.deleteReview(id);
      setReviews(reviews.filter(r => r.id !== id));
    } catch (e) { console.error(e); }
  };

  const avgRating = reviews.length ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1) : '–';

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1>Reviews</h1>
          <p className={styles.subtitle}>{reviews.length} reviews · Avg rating: <strong>{avgRating}</strong> ★</p>
        </div>
        <button className={styles.addBtn} onClick={() => setIsModalOpen(true)}>
          <Plus size={18} /> Add Review
        </button>
      </div>

      <div className={styles.tabs}>
        {['All', 'Pending', 'Approved'].map(t => (
          <button key={t} className={`${styles.tab} ${styles.activeTab}`}>{t}</button>
        ))}
      </div>

      {loading && <div className={styles.stateMsg}>Loading reviews…</div>}

      <div className={styles.grid}>
        {reviews.map(review => (
          <div key={review.id} className={`${styles.card} ${review.status === 'Approved' ? styles.approved : ''}`}>
            <div className={styles.cardHeader}>
              <div className={styles.reviewer}>
                <div className={styles.avatar}>{review.reviewer_name[0]}</div>
                <div>
                  <div className={styles.reviewerName}>{review.reviewer_name}</div>
                  {review.reviewer_email && <div className={styles.reviewerEmail}>{review.reviewer_email}</div>}
                </div>
              </div>
              <StarRating rating={review.rating} />
            </div>
            {review.title && <h4 className={styles.reviewTitle}>{review.title}</h4>}
            {review.content && <p className={styles.reviewContent}>{review.content}</p>}
            <div className={styles.cardFooter}>
              <span className={`${styles.badge} ${styles[review.status?.toLowerCase()]}`}>{review.status}</span>
              <span className={styles.source}>{review.source}</span>
              <div className={styles.actions}>
                {review.status === 'Pending' && (
                  <button className={styles.approveBtn} onClick={() => handleApprove(review)} title="Approve">
                    <CheckCircle size={16} />
                  </button>
                )}
                <button className={styles.deleteBtn} onClick={() => handleDelete(review.id)} title="Delete">
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          </div>
        ))}
        {!loading && reviews.length === 0 && (
          <div className={styles.emptyState} style={{ gridColumn: '1/-1' }}>
            <Star size={48} style={{ opacity: 0.2, marginBottom: 12 }} />
            <h3>No reviews yet</h3>
            <p>Add your first customer review to start building social proof.</p>
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h2>Add Review</h2>
              <button onClick={() => setIsModalOpen(false)}><X size={20} /></button>
            </div>
            <form onSubmit={handleCreate}>
              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label>Reviewer Name *</label>
                  <input required value={newReview.reviewer_name} onChange={e => setNewReview({ ...newReview, reviewer_name: e.target.value })} placeholder="John Doe" />
                </div>
                <div className={styles.formGroup}>
                  <label>Email</label>
                  <input type="email" value={newReview.reviewer_email} onChange={e => setNewReview({ ...newReview, reviewer_email: e.target.value })} placeholder="john@example.com" />
                </div>
              </div>
              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label>Rating *</label>
                  <select value={newReview.rating} onChange={e => setNewReview({ ...newReview, rating: parseInt(e.target.value) })}>
                    {[5, 4, 3, 2, 1].map(r => <option key={r} value={r}>{r} stars</option>)}
                  </select>
                </div>
                <div className={styles.formGroup}>
                  <label>Source</label>
                  <select value={newReview.source} onChange={e => setNewReview({ ...newReview, source: e.target.value })}>
                    {['Manual', 'Google', 'Trustpilot', 'Yelp', 'Facebook', 'Other'].map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div className={styles.formGroup}>
                <label>Title</label>
                <input value={newReview.title} onChange={e => setNewReview({ ...newReview, title: e.target.value })} placeholder="Great service!" />
              </div>
              <div className={styles.formGroup}>
                <label>Review Content</label>
                <textarea rows={4} value={newReview.content} onChange={e => setNewReview({ ...newReview, content: e.target.value })} placeholder="Describe your experience…" />
              </div>
              <div className={styles.modalActions}>
                <button type="button" className={styles.cancelBtn} onClick={() => setIsModalOpen(false)}>Cancel</button>
                <button type="submit" className={styles.submitBtn}>Save Review</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
