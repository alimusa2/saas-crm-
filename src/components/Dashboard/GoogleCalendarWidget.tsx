import React, { useState, useMemo, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Clock, Check, AlertCircle, User, Mail, Phone } from 'lucide-react';

export interface CalendarConfig {
  title?: string;
  subtitle?: string;
  available_days?: 'weekdays' | 'mon_sat' | 'all';
  start_hour?: string;
  end_hour?: string;
  duration?: string | number;
  theme_color?: string;
  margin?: string;
  assigned_to_id?: string;
}

interface GoogleCalendarWidgetProps {
  config?: CalendarConfig;
  isPreview?: boolean;
  onBookAppointment?: (bookingData: {
    title: string;
    startTime: string;
    endTime: string;
    name: string;
    email: string;
    phone: string;
  }) => Promise<void>;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parseHourToMinutes(hourStr: string): number {
  if (!hourStr) return 9 * 60;
  const parts = hourStr.trim().split(' ');
  if (parts.length < 2) return 9 * 60;
  const [time, period] = parts;
  let [h, m] = time.split(':').map(Number);
  if (period.toUpperCase() === 'PM' && h < 12) h += 12;
  if (period.toUpperCase() === 'AM' && h === 12) h = 0;
  return h * 60 + (m || 0);
}

function formatMinutesToTimeStr(mins: number): string {
  let h = Math.floor(mins / 60);
  const m = mins % 60;
  const period = h >= 12 ? 'PM' : 'AM';
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  const hStr = String(h).padStart(2, '0');
  const mStr = String(m).padStart(2, '0');
  return `${hStr}:${mStr} ${period}`;
}

export const GoogleCalendarWidget: React.FC<GoogleCalendarWidgetProps> = ({
  config = {},
  isPreview = false,
  onBookAppointment,
}) => {
  const title = config.title || 'Book an Appointment';
  const subtitle = config.subtitle || 'Select a date & available time slot below';
  const availableDaysMode = config.available_days || 'weekdays';
  const startHourStr = config.start_hour || '09:00 AM';
  const endHourStr = config.end_hour || '05:00 PM';
  const durationMins = Number(config.duration || 30);
  const themeColor = config.theme_color || '#4F46E5';

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const [currentMonthDate, setCurrentMonthDate] = useState<Date>(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const [selectedDate, setSelectedDate] = useState<Date | null>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const [selectedTimeSlot, setSelectedTimeSlot] = useState<string | null>(null);

  // Form inputs
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [generatedMeetLink, setGeneratedMeetLink] = useState<string | null>(null);

  // Month navigation
  const year = currentMonthDate.getFullYear();
  const month = currentMonthDate.getMonth();

  const handlePrevMonth = () => {
    setCurrentMonthDate(new Date(year, month - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentMonthDate(new Date(year, month + 1, 1));
  };

  // Days grid calculation
  const calendarGrid = useMemo(() => {
    const firstDayIndex = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const cells: Array<{ dayNum: number | null; dateObj: Date | null; isDisabled: boolean }> = [];

    // Preceding empty cells
    for (let i = 0; i < firstDayIndex; i++) {
      cells.push({ dayNum: null, dateObj: null, isDisabled: true });
    }

    // Active month cells
    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(year, month, d);
      dateObj.setHours(0, 0, 0, 0);

      const dayOfWeek = dateObj.getDay(); // 0 = Sun, 6 = Sat
      let isDisabled = dateObj.getTime() < today.getTime();

      if (!isDisabled) {
        if (availableDaysMode === 'weekdays' && (dayOfWeek === 0 || dayOfWeek === 6)) {
          isDisabled = true;
        } else if (availableDaysMode === 'mon_sat' && dayOfWeek === 0) {
          isDisabled = true;
        }
      }

      cells.push({ dayNum: d, dateObj, isDisabled });
    }

    return cells;
  }, [year, month, today, availableDaysMode]);

  const [bookedSlots, setBookedSlots] = useState<string[]>([]);

  // Sync with CRM project backend calendar with 5-second real-time polling
  useEffect(() => {
    let isMounted = true;
    const fetchSlots = () => {
      fetch('http://localhost:8000/api/v1/funnels/public/booked-slots')
        .then(res => res.json())
        .then(data => {
          if (isMounted && data.booked_slots) {
            setBookedSlots(data.booked_slots);
          }
        })
        .catch(() => {});
    };

    fetchSlots();
    const interval = setInterval(fetchSlots, 5000);
    window.addEventListener('appointment-updated', fetchSlots);

    return () => {
      isMounted = false;
      clearInterval(interval);
      window.removeEventListener('appointment-updated', fetchSlots);
    };
  }, []);

  // Generate dynamic time slots for selected date with booked status check
  const timeSlots = useMemo(() => {
    if (!selectedDate) return [];
    const startMins = parseHourToMinutes(startHourStr);
    const endMins = parseHourToMinutes(endHourStr);
    const slots: Array<{ timeStr: string; isBooked: boolean }> = [];

    let curr = startMins;
    while (curr + durationMins <= endMins) {
      const timeStr = formatMinutesToTimeStr(curr);
      
      let h = Math.floor(curr / 60);
      const m = curr % 60;
      const slotDate = new Date(selectedDate);
      slotDate.setHours(h, m, 0, 0);

      const isBooked = bookedSlots.some(bs => {
        const bd = new Date(bs);
        return bd.getTime() === slotDate.getTime();
      });

      slots.push({ timeStr, isBooked });
      curr += durationMins;
    }

    return slots;
  }, [selectedDate, startHourStr, endHourStr, durationMins, bookedSlots]);

  // Handle Form Booking Submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDate || !selectedTimeSlot) {
      setStatusMsg('Please select a date and time slot.');
      return;
    }

    if (isPreview) {
      setIsSuccess(true);
      setStatusMsg(`[Preview Mode] Appointment requested for ${selectedDate.toLocaleDateString()} at ${selectedTimeSlot}`);
      return;
    }

    if (!name.trim() || !email.trim()) {
      setStatusMsg('Please enter your name and email address.');
      return;
    }

    setIsSubmitting(true);
    setStatusMsg(null);

    try {
      const [timePart, ampm] = selectedTimeSlot.split(' ');
      let [h, m] = timePart.split(':').map(Number);
      if (ampm.toUpperCase() === 'PM' && h < 12) h += 12;
      if (ampm.toUpperCase() === 'AM' && h === 12) h = 0;

      const startTimeObj = new Date(selectedDate);
      startTimeObj.setHours(h, m, 0, 0);

      const endTimeObj = new Date(startTimeObj.getTime() + durationMins * 60000);

      if (onBookAppointment) {
        await onBookAppointment({
          title,
          startTime: startTimeObj.toISOString(),
          endTime: endTimeObj.toISOString(),
          name,
          email,
          phone,
        });
      } else {
        const response = await fetch('http://localhost:8000/api/v1/funnels/public/book', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            start_time: startTimeObj.toISOString(),
            end_time: endTimeObj.toISOString(),
            assigned_to_id: config.assigned_to_id || 'default_calendar',
            display_name: name,
            email,
            phone: phone || null,
          }),
        });

        const resData = await response.json();
        if (!response.ok) {
          throw new Error(resData.detail || 'Booking failed');
        }
        if (resData.meet_link || resData.location) {
          setGeneratedMeetLink(resData.meet_link || resData.location);
        }
      }

      setBookedSlots(prev => [...prev, startTimeObj.toISOString()]);
      window.dispatchEvent(new CustomEvent('appointment-updated'));
      setIsSuccess(true);
      setStatusMsg('Appointment booked successfully! Recorded in CRM Calendar & Leads timeline.');
    } catch (err: any) {
      setStatusMsg(err.message || 'Error submitting booking.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      style={{
        width: '100%',
        maxWidth: '850px',
        margin: config.margin || '20px auto',
        background: '#FFFFFF',
        borderRadius: '16px',
        border: '1px solid #E2E8F0',
        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.01)',
        padding: '24px',
        boxSizing: 'border-box',
        fontFamily: "'Inter', sans-serif",
      }}
    >
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: '24px' }}>
        <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#1E293B' }}>{title}</h3>
        {subtitle && <p style={{ margin: '6px 0 0 0', fontSize: '13.5px', color: '#64748B' }}>{subtitle}</p>}
      </div>

      {isSuccess ? (
        <div style={{ padding: '32px', textAlign: 'center', background: '#F0FDF4', borderRadius: '12px', border: '1px solid #BBF7D0' }}>
          <div style={{ width: '48px', height: '48px', background: '#22C55E', color: 'white', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px auto' }}>
            <Check size={28} />
          </div>
          <h4 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: 700, color: '#15803D' }}>Booking Confirmed!</h4>
          <p style={{ margin: 0, fontSize: '14px', color: '#166534' }}>{statusMsg || 'We have received your appointment request.'}</p>
          <div style={{ marginTop: '16px', fontSize: '13px', color: '#15803D', fontWeight: 600 }}>
            {selectedDate && selectedTimeSlot && (
              <span>📅 {selectedDate.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} at {selectedTimeSlot}</span>
            )}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px' }}>
          {/* Left Column: Mini Calendar Picker */}
          <div style={{ flex: '1 1 320px', minWidth: '280px' }}>
            {/* Month Navigation */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', padding: '0 4px' }}>
              <span style={{ fontSize: '15px', fontWeight: 700, color: '#1E293B' }}>
                {MONTH_NAMES[month]} {year}
              </span>
              <div style={{ display: 'flex', gap: '4px' }}>
                <button
                  type="button"
                  onClick={handlePrevMonth}
                  style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569' }}
                  title="Previous Month"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  type="button"
                  onClick={handleNextMonth}
                  style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569' }}
                  title="Next Month"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>

            {/* Weekday Labels Header */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', textAlign: 'center', marginBottom: '8px' }}>
              {WEEKDAY_NAMES.map(w => (
                <span key={w} style={{ fontSize: '11px', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase' }}>
                  {w}
                </span>
              ))}
            </div>

            {/* Day Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
              {calendarGrid.map((cell, idx) => {
                if (cell.dayNum === null || !cell.dateObj) {
                  return <div key={`empty-${idx}`} style={{ height: '36px' }} />;
                }

                const isSelected = selectedDate && cell.dateObj.getTime() === selectedDate.getTime();
                const isTodayDate = cell.dateObj.getTime() === today.getTime();

                return (
                  <button
                    key={`day-${cell.dayNum}`}
                    type="button"
                    disabled={cell.isDisabled}
                    onClick={() => {
                      setSelectedDate(cell.dateObj);
                      setSelectedTimeSlot(null);
                    }}
                    style={{
                      height: '36px',
                      borderRadius: '8px',
                      border: isSelected ? 'none' : isTodayDate ? `1.5px solid ${themeColor}` : '1px solid transparent',
                      background: isSelected ? themeColor : isTodayDate ? '#F1F5F9' : '#FFFFFF',
                      color: isSelected ? '#FFFFFF' : cell.isDisabled ? '#CBD5E1' : '#1E293B',
                      fontWeight: isSelected || isTodayDate ? 700 : 500,
                      fontSize: '13px',
                      cursor: cell.isDisabled ? 'not-allowed' : 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {cell.dayNum}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right Column: Time Slots & Booking Form */}
          <div style={{ flex: '1 1 280px', borderLeft: '1px solid #F1F5F9', paddingLeft: '20px', minWidth: '260px' }}>
            <div style={{ fontSize: '14px', fontWeight: 700, color: '#1E293B', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Clock size={16} style={{ color: themeColor }} />
              <span>
                {selectedDate
                  ? selectedDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
                  : 'Select a Date'}
              </span>
            </div>

            {selectedDate ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '200px', overflowY: 'auto', paddingRight: '4px' }}>
                {timeSlots.map(slotObj => {
                  const slotStr = slotObj.timeStr;
                  const isBooked = slotObj.isBooked;
                  const isSlotSelected = selectedTimeSlot === slotStr;
                  return (
                    <button
                      key={slotStr}
                      type="button"
                      disabled={isBooked}
                      onClick={() => !isBooked && setSelectedTimeSlot(slotStr)}
                      style={{
                        padding: '8px 12px',
                        borderRadius: '8px',
                        border: isSlotSelected ? `1.5px solid ${themeColor}` : '1px solid #E2E8F0',
                        background: isBooked ? '#F1F5F9' : isSlotSelected ? `${themeColor}15` : '#F8FAFC',
                        color: isBooked ? '#94A3B8' : isSlotSelected ? themeColor : '#334155',
                        fontSize: '12.5px',
                        fontWeight: isSlotSelected ? 700 : 500,
                        cursor: isBooked ? 'not-allowed' : 'pointer',
                        textAlign: 'center',
                        transition: 'all 0.15s ease',
                        textDecoration: isBooked ? 'line-through' : 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                      }}
                    >
                      <span>{slotStr}</span>
                      {isBooked && <span style={{ fontSize: '10px', fontWeight: 600, color: '#EF4444', textDecoration: 'none' }}>(Booked)</span>}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div style={{ fontSize: '13px', color: '#94A3B8', padding: '20px 0', textAlign: 'center' }}>
                Click a date on the calendar to view available time slots.
              </div>
            )}

            {/* Selection Summary & Booking Inputs */}
            {selectedDate && selectedTimeSlot && (
              isSuccess ? (
                <div style={{ padding: '20px', background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: '12px', textAlign: 'center', margin: '16px 0' }}>
                  <div style={{ fontSize: '32px', marginBottom: '8px' }}>🎉</div>
                  <h4 style={{ margin: '0 0 6px 0', fontSize: '15px', fontWeight: 700, color: '#065F46' }}>Appointment Confirmed!</h4>
                  <p style={{ margin: '0 0 14px 0', fontSize: '12.5px', color: '#047857' }}>
                    Your meeting room has been generated. Your sales host will admit you to the video call as soon as the meeting starts.
                  </p>
                  {generatedMeetLink && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                      <a
                        href={generatedMeetLink}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '10px 18px',
                          backgroundColor: '#4285F4',
                          color: '#FFFFFF',
                          borderRadius: '8px',
                          fontWeight: 700,
                          fontSize: '13px',
                          textDecoration: 'none',
                          boxShadow: '0 4px 12px rgba(66, 133, 244, 0.3)'
                        }}
                      >
                        🎥 Join Scheduled Meeting (Waiting Room) →
                      </a>
                      <span style={{ fontSize: '11px', color: '#059669', fontWeight: 500 }}>
                        🔒 Waiting Room Active • Host Admission Required
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <form onSubmit={handleSubmit} style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '10px', borderTop: '1px solid #F1F5F9', paddingTop: '14px' }}>
                  <div style={{ fontSize: '11.5px', fontWeight: 600, color: '#059669', background: '#ECFDF5', padding: '6px 10px', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Check size={14} />
                    <span>Selected: {selectedDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} at {selectedTimeSlot} ({durationMins} min)</span>
                  </div>

                  <div style={{ position: 'relative' }}>
                    <User size={14} style={{ position: 'absolute', left: '10px', top: '10px', color: '#94A3B8' }} />
                    <input
                      type="text"
                      placeholder="Your Full Name"
                      required
                      value={name}
                      onChange={e => setName(e.target.value)}
                      style={{ width: '100%', padding: '8px 12px 8px 30px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '12.5px', outline: 'none', boxSizing: 'border-box' }}
                    />
                  </div>

                  <div style={{ position: 'relative' }}>
                    <Mail size={14} style={{ position: 'absolute', left: '10px', top: '10px', color: '#94A3B8' }} />
                    <input
                      type="email"
                      placeholder="Your Email Address"
                      required
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      style={{ width: '100%', padding: '8px 12px 8px 30px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '12.5px', outline: 'none', boxSizing: 'border-box' }}
                    />
                  </div>

                  <div style={{ position: 'relative' }}>
                    <Phone size={14} style={{ position: 'absolute', left: '10px', top: '10px', color: '#94A3B8' }} />
                    <input
                      type="tel"
                      placeholder="Phone Number (optional)"
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      style={{ width: '100%', padding: '8px 12px 8px 30px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '12.5px', outline: 'none', boxSizing: 'border-box' }}
                    />
                  </div>

                  {statusMsg && (
                    <div style={{ fontSize: '12px', color: '#DC2626', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <AlertCircle size={14} /> {statusMsg}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    style={{
                      width: '100%',
                      padding: '10px',
                      borderRadius: '8px',
                      border: 'none',
                      background: themeColor,
                      color: '#FFFFFF',
                      fontWeight: 700,
                      fontSize: '13px',
                      cursor: 'pointer',
                      transition: 'background 0.15s ease',
                    }}
                  >
                    {isSubmitting ? 'Confirming...' : 'Confirm Appointment'}
                  </button>
                </form>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
};
