import React, { useState, useEffect } from 'react';
import styles from './ContactsPage.module.css';
import { contactsApi, settingsApi } from '../../lib/api';
import type { Contact } from '../../lib/api';
import { Plus, UserCircle, Mail, Phone, Trash2, Search, AlertTriangle, X } from 'lucide-react';

export const ContactsPage = () => {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newContact, setNewContact] = useState({ first_name: '', last_name: '', email: '', phone: '' });
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<any>(null);
  const [duplicateContactData, setDuplicateContactData] = useState<any>(null);

  useEffect(() => {
    fetchContacts();
    settingsApi.getProfile()
      .then(p => setProfile(p))
      .catch(e => console.error("Failed to load profile:", e));
  }, []);

  const fetchContacts = async () => {
    setLoading(true);
    try {
      const data = await contactsApi.getContacts();
      setContacts(data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const created = await contactsApi.createContact(newContact);
      setContacts([created, ...contacts]);
      setIsModalOpen(false);
      setNewContact({ first_name: '', last_name: '', email: '', phone: '' });
    } catch (err: any) {
      if (err.status === 409 && err.detail?.existing_contact) {
        setDuplicateContactData({
          existing: err.detail.existing_contact,
          payload: newContact
        });
      } else {
        alert(err.message || 'Failed to save contact');
      }
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this contact?')) return;
    try {
      await contactsApi.deleteContact(id);
      setContacts(contacts.filter(c => c.id !== id));
    } catch (e) { console.error(e); }
  };

  const filtered = contacts.filter(c =>
    `${c.first_name} ${c.last_name} ${c.email}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1>Contacts</h1>
          <p className={styles.subtitle}>{contacts.length} total contacts</p>
        </div>
        <button className={styles.addBtn} onClick={() => setIsModalOpen(true)}>
          <Plus size={18} /> Add Contact
        </button>
      </div>

      <div className={styles.searchBar}>
        <Search size={16} className={styles.searchIcon} />
        <input
          type="text"
          placeholder="Search contacts by name or email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className={styles.searchInput}
        />
      </div>

      {loading ? (
        <div className={styles.emptyState}>Loading contacts…</div>
      ) : (
        <div className={styles.grid}>
          {filtered.map(contact => (
            <div key={contact.id} className={styles.card}>
              <div className={styles.avatar}>
                {contact.first_name[0]}{contact.last_name[0]}
              </div>
              <div className={styles.cardInfo}>
                <h3 title={`${contact.first_name} ${contact.last_name}`}>{contact.first_name} {contact.last_name}</h3>
                {contact.email && (
                  <div className={styles.infoRow} title={contact.email}>
                    <Mail size={13} style={{ flexShrink: 0 }} /> <span>{contact.email}</span>
                  </div>
                )}
                {contact.phone && (
                  <div className={styles.infoRow} title={contact.phone}>
                    <Phone size={13} style={{ flexShrink: 0 }} /> <span>{contact.phone}</span>
                  </div>
                )}
              </div>
              <button className={styles.deleteBtn} onClick={() => handleDelete(contact.id)} title="Delete Contact">
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className={styles.emptyState} style={{ gridColumn: '1 / -1' }}>
              <UserCircle size={48} style={{ opacity: 0.3, marginBottom: 8 }} />
              <p>No contacts found. Add one to get started.</p>
            </div>
          )}
        </div>
      )}

      {isModalOpen && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <h2>Add New Contact</h2>
            <form onSubmit={handleCreate}>
              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label>First Name *</label>
                  <input required value={newContact.first_name} onChange={e => setNewContact({ ...newContact, first_name: e.target.value })} placeholder="John" />
                </div>
                <div className={styles.formGroup}>
                  <label>Last Name *</label>
                  <input required value={newContact.last_name} onChange={e => setNewContact({ ...newContact, last_name: e.target.value })} placeholder="Doe" />
                </div>
              </div>
              <div className={styles.formGroup}>
                <label>Email</label>
                <input type="email" value={newContact.email} onChange={e => setNewContact({ ...newContact, email: e.target.value })} placeholder="john@example.com" />
              </div>
              <div className={styles.formGroup}>
                <label>Phone</label>
                <input value={newContact.phone} onChange={e => setNewContact({ ...newContact, phone: e.target.value })} placeholder="+1 (555) 000-0000" />
              </div>
              <div className={styles.modalActions}>
                <button type="button" className={styles.cancelBtn} onClick={() => setIsModalOpen(false)}>Cancel</button>
                <button type="submit" className={styles.submitBtn}>Add Contact</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {duplicateContactData && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal} style={{ maxWidth: 500 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#d97706', margin: 0 }}>
                <AlertTriangle size={24} /> Duplicate Contact
              </h2>
              <button style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={() => setDuplicateContactData(null)}>
                <X size={20} />
              </button>
            </div>
            <div className={styles.form} style={{ padding: 0 }}>
              <p style={{ marginBottom: 16, color: 'var(--text-secondary)', fontSize: 14 }}>
                A Contact with the email <strong>{duplicateContactData.existing.email}</strong> already exists.
              </p>
              
              <div style={{
                background: '#f8fafc',
                border: '1px solid var(--border-color)',
                borderRadius: 8,
                padding: 14,
                marginBottom: 20,
                fontSize: 13
              }}>
                <div style={{ fontWeight: 600, borderBottom: '1px solid var(--border-color)', paddingBottom: 6, marginBottom: 6 }}>
                  Existing Contact Details
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div><strong>Name:</strong> {duplicateContactData.existing.first_name} {duplicateContactData.existing.last_name}</div>
                  <div><strong>Company:</strong> {duplicateContactData.existing.company_name || '—'}</div>
                  <div><strong>Created:</strong> {new Date(duplicateContactData.existing.created_at).toLocaleDateString()}</div>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button
                  type="button"
                  style={{
                    background: 'var(--primary-color)',
                    color: 'white',
                    border: 'none',
                    padding: '10px 16px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontWeight: 600
                  }}
                  onClick={() => {
                    setSearch(duplicateContactData.existing.email);
                    setDuplicateContactData(null);
                    setIsModalOpen(false);
                  }}
                >
                  View Existing Contact
                </button>

                <button
                  type="button"
                  style={{
                    background: '#059669',
                    color: 'white',
                    border: 'none',
                    padding: '10px 16px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontWeight: 600
                  }}
                  onClick={async () => {
                    if (window.confirm("Overwrite existing contact fields with the new data?")) {
                      try {
                        await contactsApi.updateContact(duplicateContactData.existing.id, duplicateContactData.payload);
                        setDuplicateContactData(null);
                        setIsModalOpen(false);
                        fetchContacts();
                        alert("Contact updated successfully!");
                      } catch (err: any) {
                        alert(err.message || "Failed to update contact");
                      }
                    }
                  }}
                >
                  Update Existing Contact (Overwrite)
                </button>

                <button
                  type="button"
                  style={{
                    background: '#2563eb',
                    color: 'white',
                    border: 'none',
                    padding: '10px 16px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontWeight: 600
                  }}
                  onClick={async () => {
                    if (window.confirm("Merge empty fields of the existing contact with the new data?")) {
                      try {
                        await contactsApi.mergeContact(duplicateContactData.existing.id, duplicateContactData.payload);
                        setDuplicateContactData(null);
                        setIsModalOpen(false);
                        fetchContacts();
                        alert("Contact merged successfully!");
                      } catch (err: any) {
                        alert(err.message || "Failed to merge contact");
                      }
                    }
                  }}
                >
                  Merge Information
                </button>

                {profile?.is_superuser && (
                  <button
                    type="button"
                    style={{
                      background: '#dc2626',
                      color: 'white',
                      border: 'none',
                      padding: '10px 16px',
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontWeight: 600
                    }}
                    onClick={async () => {
                      if (window.confirm("Create a duplicate contact (Admin Override)?")) {
                        try {
                          const created = await contactsApi.createContact(duplicateContactData.payload, true);
                          setContacts([created, ...contacts]);
                          setDuplicateContactData(null);
                          setIsModalOpen(false);
                          alert("Duplicate Contact created successfully!");
                        } catch (err: any) {
                          alert(err.message || "Failed to override duplicate");
                        }
                      }
                    }}
                  >
                    Create Duplicate (Admin Only)
                  </button>
                )}

                <button
                  type="button"
                  style={{
                    background: '#e2e8f0',
                    color: '#475569',
                    border: 'none',
                    padding: '10px 16px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontWeight: 600
                  }}
                  onClick={() => setDuplicateContactData(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
