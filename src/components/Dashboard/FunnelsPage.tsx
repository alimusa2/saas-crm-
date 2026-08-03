import React, { useState, useEffect, useCallback, useRef } from 'react';
import styles from './FunnelsPage.module.css';
import { funnelsApi, formsApi, teamApi } from '../../lib/api';
import type { Funnel, FunnelStep, FunnelAnalytics, Form, FormField, FunnelComponent, TeamMember } from '../../lib/api';
import { normalizeLayoutSettings, compileElementLayoutCSS } from '../../lib/styleEngine';
import { ICON_SVG_LIBRARY, renderSvgIcon, renderSocialLinksComponent } from './PublicFunnelPage';
import { GoogleCalendarWidget } from './GoogleCalendarWidget';
import {
  Plus, Filter, LayoutTemplate, Settings, Globe, Eye, EyeOff,
  Copy, Check, BarChart2, Trash2, ChevronDown, ChevronUp, ArrowRight, ArrowLeft,
  ImageIcon, FileText, MousePointer, Palette, CopyPlus, ArrowUp, ArrowDown,
  CheckCircle, XCircle, AlertCircle, Link, FilePlus, Video, HelpCircle, UserCheck, Play,
  Star, Heart, Mail, Phone, Calendar, Award,
  Monitor, Tablet, Smartphone, Undo2, Redo2, Layers, PanelRightOpen, MoreHorizontal
} from 'lucide-react';

const normalizeUrl = (url: string): string => {
  if (!url) return '';
  let trimmed = url.trim();
  if (trimmed.startsWith('#') || trimmed.startsWith('/') || trimmed.startsWith('mailto:') || trimmed.startsWith('tel:')) {
    return trimmed;
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = 'https://' + trimmed;
  }
  return trimmed;
};

const resolveAssetUrl = (url?: string): string => {
  if (!url) return '';
  const trimmed = url.trim();
  if (trimmed.startsWith('/static') || trimmed.startsWith('static/')) {
    const cleanPath = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    return `http://localhost:8000${cleanPath}`;
  }
  return trimmed;
};

const getCountdownStyles = (cfg: any, isMobile?: boolean) => {
  const align = cfg.align || cfg.alignment || 'center';
  const sizePreset = cfg.size || 'medium';
  const maxWidthVal = cfg.max_width || '100%';

  const containerFlexJustify = align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';

  let boxPadding = '20px 24px';
  let digitFontSize = '32px';
  let labelFontSize = '10px';
  let gapSize = '16px';

  if (sizePreset === 'small') {
    boxPadding = '12px 16px';
    digitFontSize = '20px';
    labelFontSize = '8px';
    gapSize = '10px';
  } else if (sizePreset === 'large') {
    boxPadding = '28px 36px';
    digitFontSize = '44px';
    labelFontSize = '12px';
    gapSize = '24px';
  }

  if (cfg.font_size) {
    const rawF = String(cfg.font_size).trim();
    digitFontSize = /^\d+$/.test(rawF) ? `${rawF}px` : rawF;
  }

  if (isMobile) {
    if (cfg.mobile_font_size) {
      const rawM = String(cfg.mobile_font_size).trim();
      digitFontSize = /^\d+$/.test(rawM) ? `${rawM}px` : rawM;
    } else {
      if (sizePreset === 'large') {
        digitFontSize = '26px';
        boxPadding = '16px';
        gapSize = '12px';
      } else if (sizePreset === 'medium' || !sizePreset) {
        digitFontSize = '22px';
        boxPadding = '14px';
        gapSize = '10px';
      } else if (sizePreset === 'small') {
        digitFontSize = '16px';
        boxPadding = '10px';
        gapSize = '8px';
      }
    }
  }

  return {
    align,
    containerFlexJustify,
    boxPadding,
    digitFontSize,
    labelFontSize,
    gapSize,
    maxWidthVal
  };
};

const parseVideoUrl = (url: string): { provider: 'youtube' | 'vimeo' | 'html5' | 'unknown' | 'none'; id: string } => {
  if (!url) return { provider: 'none', id: '' };
  const trimmed = url.trim();

  // YouTube: standard watch, short youtu.be, /embed/, /live/, /shorts/, and raw 11-char IDs
  const ytRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?|live|shorts)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i;
  const ytMatch = trimmed.match(ytRegex);
  if (ytMatch) {
    return { provider: 'youtube', id: ytMatch[1] };
  }

  // Raw 11-character YouTube video ID (no URL wrapper)
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return { provider: 'youtube', id: trimmed };
  }

  const vimeoRegex = /(?:https?:\/\/)?(?:www\.)?(?:vimeo\.com\/)(?:channels\/(?:\w+\/)?|groups\/([^\/]*)\/videos\/|album\/(\d+)\/video\/|video\/|)(\d+)(?:$|\/|\?)/i;
  const vimeoMatch = trimmed.match(vimeoRegex);
  if (vimeoMatch) {
    return { provider: 'vimeo', id: vimeoMatch[3] };
  }

  const ext = trimmed.split('.').pop()?.split('?')[0]?.toLowerCase() || '';
  const isDirectVideo = ['mp4', 'mov', 'webm', 'avi', 'ogv', 'm4v'].includes(ext) || trimmed.startsWith('/static/');
  if (isDirectVideo) {
    return { provider: 'html5', id: trimmed };
  }

  return { provider: 'unknown', id: trimmed };
};

const validateCssSyntax = (css: string): { isValid: boolean; error?: string } => {
  if (!css || !css.trim()) return { isValid: true };
  let openBraces = 0;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') openBraces++;
    if (css[i] === '}') {
      openBraces--;
      if (openBraces < 0) {
        return { isValid: false, error: 'Mismatched closing brace "}" without a preceding opening brace.' };
      }
    }
  }
  if (openBraces > 0) {
    return { isValid: false, error: `Unclosed style block. Missing ${openBraces} closing brace(s) "}".` };
  }
  return { isValid: true };
};

const scopeCss = (css: string, prefix: string): string => {
  if (!css || !css.trim()) return '';
  let processed = css.replace(/(\$self|&|:self|:host)/g, prefix);
  const regex = /([^\r\n,{}]+)(?=\s*{[^{}]*})/g;
  return processed.replace(regex, (match) => {
    const selector = match.trim();
    if (!selector || selector.startsWith('@') || selector.startsWith('from') || selector.startsWith('to') || /^\d+%$/.test(selector)) {
      return match;
    }
    return selector.split(',').map(sel => {
      const trimmed = sel.trim();
      if (trimmed === ':root') return prefix;
      if (trimmed.startsWith(prefix)) return trimmed;
      return `${prefix} ${trimmed}`;
    }).join(', ');
  });
};

const compilePageStyles = (layout: any): string => {
  if (!layout) return '';
  let compiled = '';

  compiled += `
  /* Global overrides */
  .funnel-page-content-wrapper, .funnel-page-content-wrapper *, .funnel-page-content-wrapper *::before, .funnel-page-content-wrapper *::after {
    box-sizing: border-box !important;
  }
  .funnel-page-content-wrapper, .funnel-page-content-wrapper *, .funnel-page-content-wrapper *::before, .funnel-page-content-wrapper *::after {
    box-sizing: border-box !important;
    max-width: 100% !important;
  }
  .funnel-page-content-wrapper img, .funnel-page-content-wrapper video, .funnel-page-content-wrapper iframe {
    max-width: 100% !important;
  }
  `;

  const getCssRules = (cfg: any) => {
    let rules = '';

    if (cfg.background_color !== undefined && cfg.background_color !== '') rules += `  background-color: ${cfg.background_color};\n`;
    if (cfg.color !== undefined && cfg.color !== '') rules += `  color: ${cfg.color};\n`;
    if (cfg.border_style !== undefined && cfg.border_style !== 'none' && cfg.border_style !== '') {
      rules += `  border-style: ${cfg.border_style};\n`;
      if (cfg.border_width !== undefined && cfg.border_width !== '') rules += `  border-width: ${cfg.border_width};\n`;
      if (cfg.border_color !== undefined && cfg.border_color !== '') rules += `  border-color: ${cfg.border_color};\n`;
    }
    if (cfg.border_radius !== undefined && cfg.border_radius !== '') rules += `  border-radius: ${cfg.border_radius};\n`;
    if (cfg.box_shadow !== undefined && cfg.box_shadow !== 'none' && cfg.box_shadow !== '') rules += `  box-shadow: ${cfg.box_shadow};\n`;
    if (cfg.opacity !== undefined && cfg.opacity !== '') rules += `  opacity: ${cfg.opacity};\n`;

    if (cfg.font_family !== undefined && cfg.font_family !== '') rules += `  font-family: ${cfg.font_family};\n`;
    if (cfg.font_size !== undefined && cfg.font_size !== '') rules += `  font-size: ${cfg.font_size};\n`;
    if (cfg.font_weight !== undefined && cfg.font_weight !== '') rules += `  font-weight: ${cfg.font_weight};\n`;
    if (cfg.line_height !== undefined && cfg.line_height !== '') rules += `  line-height: ${cfg.line_height};\n`;
    if (cfg.letter_spacing !== undefined && cfg.letter_spacing !== '') rules += `  letter-spacing: ${cfg.letter_spacing};\n`;
    if (cfg.word_spacing !== undefined && cfg.word_spacing !== '') rules += `  word-spacing: ${cfg.word_spacing};\n`;
    if (cfg.text_transform !== undefined && cfg.text_transform !== '') rules += `  text-transform: ${cfg.text_transform};\n`;

    if (cfg.visibility === 'hidden') rules += `  display: none !important;\n`;

    return rules;
  };

  const getResponsiveRules = (cfg: any, device: 'tablet' | 'mobile') => {
    let rules = '';
    const suffix = `_${device}`;

    const keys = [
      'font_size', 'line_height', 'letter_spacing', 'visibility'
    ];

    keys.forEach(k => {
      let val = cfg[k + suffix];
      if (k === 'font_size' && device === 'mobile' && (cfg.mobile_font_size !== undefined && cfg.mobile_font_size !== '')) {
        val = cfg.mobile_font_size;
      }
      if (val !== undefined && val !== '') {
        let cssProp = k.replace('_', '-');
        if (k === 'alignment' || k === 'align') cssProp = 'text-align';

        if (k === 'visibility') {
          if (val === 'hidden') rules += `  display: none !important;\n`;
          else if (val === 'visible') rules += `  display: flex !important;\n`;
        } else {
          rules += `  ${cssProp}: ${val};\n`;
        }
      }
    });

    if (device === 'mobile' && cfg.visibility === 'desktop_only') {
      rules += `  display: none !important;\n`;
    }
    if (device === 'tablet' && cfg.visibility === 'mobile_only') {
      rules += `  display: none !important;\n`;
    }

    return rules;
  };

  if (layout.globalSettings?.custom_css) {
    compiled += `/* Page CSS */\n` + scopeCss(layout.globalSettings.custom_css, '.funnel-page-content-wrapper') + '\n';
  }

  let defaultRules = '';
  let tabletRules = '';
  let mobileRules = '';

  if (layout.sections) {
    layout.sections.forEach((sec: any) => {
      const secClass = `sec-${sec.id}`;
      const secCfg = sec.settings || {};

      const normalizedLayout = normalizeLayoutSettings(secCfg, 'section', sec.type);
      const layoutStyles = compileElementLayoutCSS(secClass, normalizedLayout);
      defaultRules += layoutStyles.defaultRules;
      tabletRules += layoutStyles.tabletRules;
      mobileRules += layoutStyles.mobileRules;

      const secRules = getCssRules(secCfg);
      if (secRules) defaultRules += `.${secClass} {\n${secRules}}\n`;

      const secTab = getResponsiveRules(secCfg, 'tablet');
      if (secTab) tabletRules += `.${secClass} {\n${secTab}}\n`;

      const secMob = getResponsiveRules(secCfg, 'mobile');
      if (secMob) mobileRules += `.${secClass} {\n${secMob}}\n`;

      if (secCfg.custom_css) {
        compiled += `/* Section ${sec.id} CSS */\n` + scopeCss(secCfg.custom_css, `.${secClass}`) + '\n';
      }

      if (sec.type === 'Navbar') {
        const s = secCfg;
        compiled += `
        /* Navbar ${sec.id} Styles */
        .${secClass} .brand-logo-text {
          font-family: ${s.logo_font_family || 'inherit'} !important;
          font-size: ${s.logo_font_size || '20px'} !important;
          font-weight: ${s.logo_font_weight || '800'} !important;
          color: ${s.logo_font_color || '#1e293b'} !important;
          letter-spacing: ${s.logo_letter_spacing || '-0.3px'} !important;
          transition: color 0.15s ease !important;
        }
        .${secClass} .brand-logo-text:hover { color: ${s.logo_hover_color || s.logo_font_color || '#1e293b'} !important; }
        .${secClass} .nav-item-link {
          background: none; border: none;
          font-family: ${s.nav_font_family || 'inherit'} !important;
          font-size: ${s.nav_font_size || '15px'} !important;
          font-weight: ${s.nav_font_weight || '600'} !important;
          color: ${s.nav_color || '#475569'};
          padding: ${s.nav_padding || '4px 0'} !important;
          cursor: pointer !important; transition: all 0.15s ease !important;
        }
        .${secClass} .nav-item-link:hover { color: ${s.nav_hover_color || '#4f46e5'} !important; }
        .${secClass} .nav-cta-btn {
          background: ${s.cta_bg_color || 'linear-gradient(135deg, #6366f1, #4f46e5)'} !important;
          color: ${s.cta_text_color || '#ffffff'} !important;
          border: ${s.cta_border || (s.cta_style === 'outline' ? '2px solid #4f46e5' : 'none')} !important;
          border-radius: ${s.cta_border_radius || '8px'} !important;
          padding: ${s.cta_padding || '8px 18px'} !important;
          font-size: ${s.cta_size || '14px'} !important;
          font-weight: 700 !important; cursor: pointer !important; transition: all 0.2s ease !important;
        }
        .${secClass} .nav-cta-btn:hover {
          background: ${s.cta_hover_bg_color || s.cta_bg_color || '#4338ca'} !important;
        }
        `;
      }

      if (sec.rows) {
        sec.rows.forEach((row: any) => {
          const rowClass = `row-${row.id}`;
          const rowCfg = row.settings || {};

          const normRow = normalizeLayoutSettings(rowCfg, 'row');
          const rowLayoutStyles = compileElementLayoutCSS(rowClass, normRow);
          defaultRules += rowLayoutStyles.defaultRules;
          tabletRules += rowLayoutStyles.tabletRules;
          mobileRules += rowLayoutStyles.mobileRules;

          let rowDefaultStructural = '';
          rowDefaultStructural += `  gap: ${rowCfg.gap || '20px'};\n`;
          rowDefaultStructural += `  align-items: ${rowCfg.align_items || 'stretch'};\n`;
          rowDefaultStructural += `  justify-content: ${rowCfg.justify_content || 'flex-start'};\n`;
          defaultRules += `.${rowClass} {\n${rowDefaultStructural}}\n`;

          const rowRules = getCssRules(rowCfg);
          if (rowRules) defaultRules += `.${rowClass} {\n${rowRules}}\n`;

          const rowTab = getResponsiveRules(rowCfg, 'tablet');
          if (rowTab) tabletRules += `.${rowClass} {\n${rowTab}}\n`;

          const rowMob = getResponsiveRules(rowCfg, 'mobile');
          if (rowMob) mobileRules += `.${rowClass} {\n${rowMob}}\n`;

          if (row.columns) {
            row.columns.forEach((col: any, colIdx: number) => {
              const colClass = `col-${col.id}`;
              const colCfg = col.settings || {};

              const normCol = normalizeLayoutSettings(colCfg, 'column');
              const colLayoutStyles = compileElementLayoutCSS(colClass, normCol);
              defaultRules += colLayoutStyles.defaultRules;
              tabletRules += colLayoutStyles.tabletRules;
              mobileRules += colLayoutStyles.mobileRules;

              let colDefaultStructural = '';
              colDefaultStructural += `  gap: ${colCfg.gap || '12px'};\n`;
              colDefaultStructural += `  align-items: ${colCfg.align_items || 'stretch'};\n`;
              if (colCfg.background_color) colDefaultStructural += `  background: ${colCfg.background_color};\n`;
              if (colCfg.border_radius) colDefaultStructural += `  border-radius: ${colCfg.border_radius};\n`;

              // Standardize column width generation
              let pct = '100%';
              const w = col.width;
              if (w === '100%') {
                pct = '100%';
              } else if (w === '50/50' || w === '1/2') {
                pct = '50%';
              } else if (w === '33/33/33' || w === '1/3') {
                pct = '33.3333%';
              } else if (w === '1/4') {
                pct = '25%';
              } else if (w === '25/75') {
                pct = colIdx === 0 ? '25%' : '75%';
              } else if (w === '75/25') {
                pct = colIdx === 0 ? '75%' : '25%';
              } else if (typeof w === 'string' && w.endsWith('%')) {
                pct = w;
              }
              colDefaultStructural += `  flex: 0 0 ${pct};\n`;
              colDefaultStructural += `  max-width: ${pct};\n`;
              colDefaultStructural += `  box-sizing: border-box;\n`;

              defaultRules += `.${colClass} {\n${colDefaultStructural}}\n`;

              const colRules = getCssRules(colCfg);
              if (colRules) defaultRules += `.${colClass} {\n${colRules}}\n`;

              const colTab = getResponsiveRules(colCfg, 'tablet');
              if (colTab) tabletRules += `.${colClass} {\n${colTab}}\n`;

              const colMob = getResponsiveRules(colCfg, 'mobile');
              if (colMob) mobileRules += `.${colClass} {\n${colMob}}\n`;

              if (col.components) {
                col.components.forEach((comp: any) => {
                  const compClass = `comp-${comp.id}`;
                  let compCfg: any = {};
                  try {
                    compCfg = typeof comp.config === 'string' ? JSON.parse(comp.config || '{}') : (comp.config || {});
                  } catch { }

                  const normComp = normalizeLayoutSettings(compCfg, 'component', comp.type);
                  const compLayoutStyles = compileElementLayoutCSS(compClass, normComp);
                  defaultRules += compLayoutStyles.defaultRules;
                  tabletRules += compLayoutStyles.tabletRules;
                  mobileRules += compLayoutStyles.mobileRules;

                  let compStructural = '';
                  const compType = comp.type;
                  if (compType === 'Heading') {
                    const level = compCfg.level || 'h2';
                    const defaultSize = level === 'h1' ? '48px' : level === 'h2' ? '36px' : level === 'h3' ? '24px' : '20px';
                    const defaultWeight = level === 'h1' || level === 'h2' ? '700' : '600';
                    const defaultColor = '#111827';

                    compStructural += `  font-family: ${compCfg.font_family || 'inherit'};\n`;
                    compStructural += `  font-size: ${compCfg.font_size || defaultSize};\n`;
                    compStructural += `  font-weight: ${compCfg.font_weight || defaultWeight};\n`;
                    compStructural += `  color: ${compCfg.color || defaultColor};\n`;
                    compStructural += `  text-align: ${compCfg.alignment || compCfg.align || 'left'};\n`;
                    compStructural += `  line-height: ${compCfg.line_height || '1.2'};\n`;
                    if (compCfg.max_width) compStructural += `  max-width: ${compCfg.max_width};\n`;
                    compStructural += `  letter-spacing: ${compCfg.letter_spacing || 'normal'};\n`;
                    compStructural += `  text-transform: ${compCfg.text_transform || 'none'};\n`;
                  } else if (compType === 'Paragraph' || compType === 'Text') {
                    if (compCfg.font_family) compStructural += `  font-family: ${compCfg.font_family};\n`;
                    if (compCfg.font_size) compStructural += `  font-size: ${compCfg.font_size};\n`;
                    if (compCfg.font_weight) compStructural += `  font-weight: ${compCfg.font_weight};\n`;
                    if (compCfg.color) compStructural += `  color: ${compCfg.color};\n`;
                    if (compCfg.align || compCfg.alignment) compStructural += `  text-align: ${compCfg.alignment || compCfg.align};\n`;
                    if (compCfg.line_height) compStructural += `  line-height: ${compCfg.line_height};\n`;
                    if (compCfg.max_width) compStructural += `  max-width: ${compCfg.max_width};\n`;
                    if (compCfg.letter_spacing) compStructural += `  letter-spacing: ${compCfg.letter_spacing};\n`;
                    if (compCfg.text_transform) compStructural += `  text-transform: ${compCfg.text_transform};\n`;
                  }
                  if (compStructural) defaultRules += `.${compClass} {\n${compStructural}}\n`;

                  const compRules = getCssRules(compCfg);
                  if (compRules) defaultRules += `.${compClass} {\n${compRules}}\n`;

                  const compTab = getResponsiveRules(compCfg, 'tablet');
                  if (compTab) tabletRules += `.${compClass} {\n${compTab}}\n`;

                  const compMob = getResponsiveRules(compCfg, 'mobile');
                  if (compMob) mobileRules += `.${compClass} {\n${compMob}}\n`;

                  if (compCfg.custom_css) {
                    compiled += `/* Component ${comp.id} CSS */\n` + scopeCss(compCfg.custom_css, `.${compClass}`) + '\n';
                  }
                });
              }
            });
          }
        });
      }
    });
  }

  compiled += defaultRules;
  if (tabletRules) {
    compiled += tabletRules;
  }
  if (mobileRules) {
    compiled += mobileRules;
  }

  return compiled;
};;

type TabView = 'builder' | 'analytics';
type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

const ToastContainer: React.FC<{ toasts: Toast[]; onDismiss: (id: number) => void }> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;
  return (
    <div className={styles.toastContainer}>
      {toasts.map(t => (
        <div key={t.id} className={`${styles.toast} ${styles[`toast_${t.type}`]}`} onClick={() => onDismiss(t.id)}>
          {t.type === 'success' && <CheckCircle size={16} />}
          {t.type === 'error' && <XCircle size={16} />}
          {t.type === 'info' && <AlertCircle size={16} />}
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
};

export const FUNNEL_TEMPLATES = [
  { id: 'lead_gen', name: 'Lead Generation', description: 'Capture qualified leads using high-converting forms.', steps: ['Landing Page', 'Thank You Page'], type: 'Lead', icon: '👥' },
  { id: 'agency', name: 'Agency Landing Page', description: 'Showcase agency services, testimonials, and booking widgets.', steps: ['Home Page', 'Contact Page'], type: 'Lead', icon: '🏢' },
  { id: 'saas', name: 'SaaS Product Page', description: 'Introduce features, pricing grids, and product highlights.', steps: ['Home Page', 'Signup Page'], type: 'Lead', icon: '💻' },
  { id: 'consultation', name: 'Consultation Booking', description: 'Schedule strategic advisory calls with prospective clients.', steps: ['Booking Page', 'Confirmation Page'], type: 'Appointment', icon: '📅' },
  { id: 'webinar', name: 'Webinar Masterclass', description: 'Generate live event registrants with registration forms & countdown timers.', steps: ['Registration Page', 'Confirmation Page'], type: 'Lead', icon: '🎥' },
  { id: 'product_launch', name: 'Product Launch', description: 'Build hype for upcoming products and coordinate beta access registrations.', steps: ['Pre-Launch Page', 'Thank You Page'], type: 'Lead', icon: '🚀' },
  { id: 'real_estate', name: 'Real Estate Showings', description: 'Promote house listings and coordinate property viewing appointments.', steps: ['Property Page', 'Confirmation Page'], type: 'Appointment', icon: '🏠' },
  { id: 'healthcare', name: 'Healthcare & Medical Clinic', description: 'Allow patients to schedule virtual and in-person consultations.', steps: ['Clinic Page', 'Confirmation Page'], type: 'Appointment', icon: '🩺' },
  { id: 'education', name: 'Education & Online Courses', description: 'Enroll students in training programs, masterclasses, and bootcamps.', steps: ['Course Page', 'Confirmation Page'], type: 'Lead', icon: '🎓' }
];

export const generateTemplateLayout = (templateName: string, stepName: string, firstFormId?: string, firstCalendarId?: string): string => {
  const makeId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  let sections: any[] = [];

  if (templateName === 'Lead Generation') {
    if (stepName === 'Landing Page') {
      sections = [
        {
          id: makeId('sec'),
          name: 'Hero Section',
          type: 'Hero',
          settings: { padding: '60px 0', background_color: '#ffffff', container_width: 'container', visibility: 'both' },
          rows: [{
            id: makeId('row'),
            settings: {},
            columns: [{
              id: makeId('col'),
              width: '100%',
              settings: {},
              components: [
                { id: makeId('comp'), type: 'Heading', config: JSON.stringify({ text: 'Unlock Your Business Potential', level: 'h1', align: 'center', color: '#4F46E5' }) },
                { id: makeId('comp'), type: 'Paragraph', config: JSON.stringify({ text: 'Convert more traffic into leads, bookings, and recurring revenue with a unified responsive CRM sales suite.', align: 'center', color: '#4B5563' }) },
                { id: makeId('comp'), type: 'Form', config: JSON.stringify({ form_id: firstFormId || '' }) }
              ]
            }]
          }]
        }
      ];
    } else if (stepName === 'Thank You Page') {
      sections = [
        {
          id: makeId('sec'),
          name: 'Thank You Section',
          type: 'About',
          settings: { padding: '60px 0', background_color: '#ffffff', container_width: 'container', visibility: 'both' },
          rows: [{
            id: makeId('row'),
            settings: {},
            columns: [{
              id: makeId('col'),
              width: '100%',
              settings: {},
              components: [
                { id: makeId('comp'), type: 'Heading', config: JSON.stringify({ text: 'Thank You for Registering! 🎉', level: 'h2', align: 'center', color: '#111827' }) },
                { id: makeId('comp'), type: 'Paragraph', config: JSON.stringify({ text: 'We have sent details to your inbox. In the meantime, feel free to visit our main platform.', align: 'center', color: '#4B5563' }) },
                { id: makeId('comp'), type: 'Button', config: JSON.stringify({ text: 'Go to Dashboard', size: 'medium', alignment: 'center', style: 'primary', color: '#4F46E5', text_color: '#FFFFFF', border_radius: '8px' }) }
              ]
            }]
          }]
        }
      ];
    }
  } else if (templateName === 'Appointment Booking') {
    if (stepName === 'Landing Page') {
      sections = [
        {
          id: makeId('sec'),
          name: 'Booking Hero Section',
          type: 'Hero',
          settings: { padding: '60px 0', background_color: '#ffffff', container_width: 'container', visibility: 'both' },
          rows: [{
            id: makeId('row'),
            settings: {},
            columns: [{
              id: makeId('col'),
              width: '100%',
              settings: {},
              components: [
                { id: makeId('comp'), type: 'Heading', config: JSON.stringify({ text: 'Book Your Growth Consultation', level: 'h1', align: 'center', color: '#4F46E5' }) },
                { id: makeId('comp'), type: 'Paragraph', config: JSON.stringify({ text: 'Pick a slot from our calendar to connect with an executive advisor.', align: 'center', color: '#4B5563' }) },
                { id: makeId('comp'), type: 'Calendar', config: JSON.stringify({ title: 'Book Strategy Call', calendar_id: firstCalendarId || '' }) }
              ]
            }]
          }]
        }
      ];
    } else if (stepName === 'Thank You / Confirmation') {
      sections = [
        {
          id: makeId('sec'),
          name: 'Confirmation Section',
          type: 'About',
          settings: { padding: '60px 0', background_color: '#ffffff', container_width: 'container', visibility: 'both' },
          rows: [{
            id: makeId('row'),
            settings: {},
            columns: [{
              id: makeId('col'),
              width: '100%',
              settings: {},
              components: [
                { id: makeId('comp'), type: 'Heading', config: JSON.stringify({ text: 'Meeting Confirmed! 🎉', level: 'h2', align: 'center', color: '#111827' }) },
                { id: makeId('comp'), type: 'Paragraph', config: JSON.stringify({ text: 'We have sent an email confirmation with calendar link details.', align: 'center', color: '#4B5563' }) }
              ]
            }]
          }]
        }
      ];
    }
  } else if (templateName === 'Webinar Registration') {
    if (stepName === 'Registration Page') {
      sections = [
        {
          id: makeId('sec'),
          name: 'Hero Section',
          type: 'Hero',
          settings: { padding: '60px 0', background_color: '#ffffff', container_width: 'container', visibility: 'both' },
          rows: [{
            id: makeId('row'),
            settings: {},
            columns: [{
              id: makeId('col'),
              width: '100%',
              settings: {},
              components: [
                { id: makeId('comp'), type: 'Heading', config: JSON.stringify({ text: 'Live Masterclass: Scale Your SaaS CRM', level: 'h1', align: 'center', color: '#4F46E5' }) },
                { id: makeId('comp'), type: 'Paragraph', config: JSON.stringify({ text: 'Join our interactive live webinar session next Thursday.', align: 'center', color: '#4B5563' }) },
                { id: makeId('comp'), type: 'Form', config: JSON.stringify({ form_id: firstFormId || '' }) }
              ]
            }]
          }]
        }
      ];
    } else if (stepName === 'Thank You & Confirmation') {
      sections = [
        {
          id: makeId('sec'),
          name: 'Confirmation Section',
          type: 'About',
          settings: { padding: '60px 0', background_color: '#ffffff', container_width: 'container', visibility: 'both' },
          rows: [{
            id: makeId('row'),
            settings: {},
            columns: [{
              id: makeId('col'),
              width: '100%',
              settings: {},
              components: [
                { id: makeId('comp'), type: 'Heading', config: JSON.stringify({ text: "You're Registered! Check Your Inbox", level: 'h2', align: 'center', color: '#111827' }) },
                { id: makeId('comp'), type: 'Paragraph', config: JSON.stringify({ text: 'Save the date and join live using the link sent via email.', align: 'center', color: '#4B5563' }) }
              ]
            }]
          }]
        }
      ];
    } else if (stepName === 'Replay Page') {
      sections = [
        {
          id: makeId('sec'),
          name: 'Video Section',
          type: 'Video',
          settings: { padding: '60px 0', background_color: '#ffffff', container_width: 'container', visibility: 'both' },
          rows: [{
            id: makeId('row'),
            settings: {},
            columns: [{
              id: makeId('col'),
              width: '100%',
              settings: {},
              components: [
                { id: makeId('comp'), type: 'Heading', config: JSON.stringify({ text: 'Webinar Replay Video Recording', level: 'h2', align: 'center', color: '#111827' }) },
                { id: makeId('comp'), type: 'Video', config: JSON.stringify({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', provider: 'youtube' }) },
                { id: makeId('comp'), type: 'Button', config: JSON.stringify({ text: 'Get GrowthOS CRM Now', size: 'large', alignment: 'center', style: 'primary', color: '#4F46E5', text_color: '#FFFFFF', border_radius: '8px' }) }
              ]
            }]
          }]
        }
      ];
    }
  } else if (templateName === 'Product / Sales Page') {
    if (stepName === 'Sales Page') {
      sections = [
        {
          id: makeId('sec'),
          name: 'Hero Section',
          type: 'Hero',
          settings: { padding: '60px 0', background_color: '#ffffff', container_width: 'container', visibility: 'both' },
          rows: [{
            id: makeId('row'),
            settings: {},
            columns: [{
              id: makeId('col'),
              width: '100%',
              settings: {},
              components: [
                { id: makeId('comp'), type: 'Heading', config: JSON.stringify({ text: 'The Ultimate GrowthOS Sales CRM Suite', level: 'h1', align: 'center', color: '#4F46E5' }) },
                { id: makeId('comp'), type: 'Paragraph', config: JSON.stringify({ text: 'Everything your startup needs to track pipelines, automate leads, and invoice clients.', align: 'center', color: '#4B5563' }) },
                { id: makeId('comp'), type: 'Button', config: JSON.stringify({ text: 'Buy Now - Save 50% Today', size: 'large', alignment: 'center', style: 'primary', color: '#4F46E5', text_color: '#FFFFFF', border_radius: '8px' }) }
              ]
            }]
          }]
        }
      ];
    } else if (stepName === 'Order Page') {
      sections = [
        {
          id: makeId('sec'),
          name: 'Checkout Section',
          type: 'Hero',
          settings: { padding: '60px 0', background_color: '#ffffff', container_width: 'container', visibility: 'both' },
          rows: [{
            id: makeId('row'),
            settings: {},
            columns: [{
              id: makeId('col'),
              width: '100%',
              settings: {},
              components: [
                { id: makeId('comp'), type: 'Heading', config: JSON.stringify({ text: 'Complete Your Order', level: 'h2', align: 'center', color: '#111827' }) },
                { id: makeId('comp'), type: 'Form', config: JSON.stringify({ form_id: firstFormId || '' }) }
              ]
            }]
          }]
        }
      ];
    } else if (stepName === 'Thank You & Order Confirmation') {
      sections = [
        {
          id: makeId('sec'),
          name: 'Confirmation Section',
          type: 'About',
          settings: { padding: '60px 0', background_color: '#ffffff', container_width: 'container', visibility: 'both' },
          rows: [{
            id: makeId('row'),
            settings: {},
            columns: [{
              id: makeId('col'),
              width: '100%',
              settings: {},
              components: [
                { id: makeId('comp'), type: 'Heading', config: JSON.stringify({ text: 'Order Placed Successfully! 🚀', level: 'h2', align: 'center', color: '#111827' }) },
                { id: makeId('comp'), type: 'Paragraph', config: JSON.stringify({ text: 'Your CRM workspace license is now active. Check your inbox for account setup guides.', align: 'center', color: '#4B5563' }) }
              ]
            }]
          }]
        }
      ];
    }
  } else if (templateName === 'Free Trial Funnel') {
    if (stepName === 'Landing Page') {
      sections = [
        {
          id: makeId('sec'),
          name: 'Hero Section',
          type: 'Hero',
          settings: { padding: '60px 0', background_color: '#ffffff', container_width: 'container', visibility: 'both' },
          rows: [{
            id: makeId('row'),
            settings: {},
            columns: [{
              id: makeId('col'),
              width: '100%',
              settings: {},
              components: [
                { id: makeId('comp'), type: 'Heading', config: JSON.stringify({ text: 'Start Your 14-Day Free CRM Trial', level: 'h1', align: 'center', color: '#4F46E5' }) },
                { id: makeId('comp'), type: 'Paragraph', config: JSON.stringify({ text: 'No credit card required. Cancel anytime you want.', align: 'center', color: '#4B5563' }) },
                { id: makeId('comp'), type: 'Button', config: JSON.stringify({ text: 'Start Trial Now', size: 'large', alignment: 'center', style: 'primary', color: '#4F46E5', text_color: '#FFFFFF', border_radius: '8px' }) }
              ]
            }]
          }]
        }
      ];
    } else if (stepName === 'Sign Up Form') {
      sections = [
        {
          id: makeId('sec'),
          name: 'Signup Section',
          type: 'Hero',
          settings: { padding: '60px 0', background_color: '#ffffff', container_width: 'container', visibility: 'both' },
          rows: [{
            id: makeId('row'),
            settings: {},
            columns: [{
              id: makeId('col'),
              width: '100%',
              settings: {},
              components: [
                { id: makeId('comp'), type: 'Heading', config: JSON.stringify({ text: 'Create Your Account', level: 'h2', align: 'center', color: '#111827' }) },
                { id: makeId('comp'), type: 'Form', config: JSON.stringify({ form_id: firstFormId || '' }) }
              ]
            }]
          }]
        }
      ];
    } else if (stepName === 'Welcome & Onboarding') {
      sections = [
        {
          id: makeId('sec'),
          name: 'Welcome Section',
          type: 'About',
          settings: { padding: '60px 0', background_color: '#ffffff', container_width: 'container', visibility: 'both' },
          rows: [{
            id: makeId('row'),
            settings: {},
            columns: [{
              id: makeId('col'),
              width: '100%',
              settings: {},
              components: [
                { id: makeId('comp'), type: 'Heading', config: JSON.stringify({ text: 'Welcome to GrowthOS CRM! 👋', level: 'h2', align: 'center', color: '#111827' }) },
                { id: makeId('comp'), type: 'Paragraph', config: JSON.stringify({ text: 'Let us set up your pipelines. Watch this 2-minute video to get started.', align: 'center', color: '#4B5563' }) },
                { id: makeId('comp'), type: 'Video', config: JSON.stringify({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', provider: 'youtube' }) }
              ]
            }]
          }]
        }
      ];
    }
  }

  if (sections.length === 0) {
    sections = [{
      id: makeId('sec'),
      name: 'Blank Section',
      type: 'Blank Section',
      settings: { padding: '40px 0', background_color: '#ffffff', container_width: 'container', visibility: 'both' },
      rows: [{
        id: makeId('row'),
        settings: {},
        columns: [{
          id: makeId('col'),
          width: '100%',
          settings: {},
          components: []
        }]
      }]
    }];
  } else {
    // Inject Navigation Bar and Footer automatically to template steps
    const navbarSection = {
      id: makeId('sec'),
      name: 'Navigation Bar',
      type: 'Navbar',
      settings: {
        padding: '15px 20px',
        background_color: '#ffffff',
        container_width: 'container',
        visibility: 'both',
        section_animation: 'none',
        logo_text: '🚀 GrowthOS',
        logo_url: '',
        logo_align: 'left',
        sticky: false,
        transparent: false,
        shadow: 'light',
        show_divider: true,
        links: [
          { label: 'Features', url: '#features' },
          { label: 'Pricing', url: '#pricing' },
          { label: 'FAQ', url: '#faq' }
        ],
        cta_text: 'Try Free',
        cta_url: '#cta',
        cta_style: 'primary'
      },
      rows: []
    };

    const footerSection = {
      id: makeId('sec'),
      name: 'Footer',
      type: 'Footer',
      settings: {
        padding: '56px 24px 28px 24px',
        background_color: '#1E293B',
        footer_background_color: '#1E293B',
        footer_text_color: '#94A3B8',
        footer_heading_color: '#FFFFFF',
        footer_link_color: '#94A3B8',
        footer_link_hover_color: '#6366F1',
        footer_copyright_text: '© 2026 GrowthOS Inc. All rights reserved.',
        footer_columns_count: 5,
        footer_columns: [
          {
            id: 'col_brand',
            type: 'brand',
            title: '🚀 GrowthOS',
            content: { tagline: 'Accelerating growth and pipeline velocity with modern marketing funnels.' }
          },
          {
            id: 'col_links',
            type: 'links',
            title: 'Quick Links',
            links: [
              { label: 'Features', url: '#features' },
              { label: 'Pricing', url: '#pricing' },
              { label: 'Integrations', url: '#integrations' },
              { label: 'Case Studies', url: '#cases' }
            ]
          },
          {
            id: 'col_resources',
            type: 'resources',
            title: 'Resources',
            links: [
              { label: 'Documentation', url: '#docs' },
              { label: 'API Reference', url: '#api' },
              { label: 'Community', url: '#community' },
              { label: 'Blog', url: '#blog' }
            ]
          },
          {
            id: 'col_contact',
            type: 'contact',
            title: 'Contact Us',
            content: {
              phone: '+1 (800) 555-0199',
              email: 'support@growthos.com',
              address: '100 Innovation Way, San Francisco, CA'
            }
          },
          {
            id: 'col_newsletter',
            type: 'newsletter',
            title: 'Newsletter',
            newsletter: {
              description: 'Subscribe for product updates and growth insights.',
              placeholder: 'Enter your email...',
              button_text: 'Subscribe',
              success_msg: 'Thank you for subscribing!'
            }
          }
        ],
        footer_legal_links: [
          { label: 'Privacy Policy', url: '#privacy' },
          { label: 'Terms of Service', url: '#terms' },
          { label: 'Cookie Policy', url: '#cookies' }
        ]
      },
      rows: []
    };

    sections = [navbarSection, ...sections, footerSection];
  }

  return JSON.stringify({ sections });
};

// ─── Footer SVG Social Icons ───────────────────────────────────────────────
const renderFooterSocialSvg = (platform: string, color = 'currentColor', size = 16) => {
  const p = (platform || '').toLowerCase();
  if (p === 'facebook') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
      </svg>
    );
  }
  if (p === 'instagram') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect>
        <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
        <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>
      </svg>
    );
  }
  if (p === 'linkedin') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
        <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.88 8.56a1.68 1.68 0 0 0 1.68-1.68c0-.93-.75-1.69-1.68-1.69a1.69 1.69 0 0 0-1.69 1.69c0 .93.76 1.68 1.69 1.68m1.39 9.94v-8.37H5.5v8.37h2.77z" />
      </svg>
    );
  }
  if (p === 'twitter' || p === 'x') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    );
  }
  if (p === 'youtube') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
      </svg>
    );
  }
  if (p === 'tiktok') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
        <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.97v7.02c.01 1.72-.4 3.48-1.26 4.95-1.28 2.21-3.66 3.65-6.19 3.86-2.53.21-5.11-.64-6.86-2.43C.56 19.64-.19 17.02.03 14.48c.22-2.54 1.68-4.91 3.9-6.18 1.72-.98 3.76-1.34 5.72-1.02V11.4c-1.14-.34-2.4-.18-3.41.42-1.01.6-1.67 1.68-1.78 2.84-.11 1.16.33 2.33 1.16 3.12.83.79 2.01 1.17 3.16 1.02 1.15-.15 2.17-.89 2.68-1.92.36-.73.49-1.56.49-2.37V.02z" />
      </svg>
    );
  }
  if (p === 'github') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
        <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
      </svg>
    );
  }
  if (p === 'discord') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
        <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.093.252-.19.373-.287a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.009c.12.098.246.195.373.288a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.893.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
      </svg>
    );
  }
  if (p === 'whatsapp') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
        <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" />
      </svg>
    );
  }
  if (p === 'telegram') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
        <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.831-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="2" y1="12" x2="22" y2="12"></line>
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
    </svg>
  );
};

// ─── Legacy Normalization Fallback ─────────────────────────────────────────
const getNormalizedFooterColumns = (s: any): any[] => {
  if (Array.isArray(s.footer_columns) && s.footer_columns.length > 0) {
    return s.footer_columns;
  }
  const cols: any[] = [];

  // Column 1: Brand / Company
  cols.push({
    id: 'col_brand',
    type: 'brand',
    title: s.footer_company_name || s.footer_brand_title || s.footer_logo_text || s.company_name || '🚀 GrowthOS',
    content: {
      tagline: s.footer_tagline || 'Accelerating growth and pipeline velocity with modern marketing funnels.'
    }
  });

  // Column 2: Quick Links
  const links = s.footer_links || s.links || [
    { label: 'Privacy Policy', url: '#' },
    { label: 'Terms of Service', url: '#' },
    { label: 'Contact Us', url: '#' }
  ];
  cols.push({
    id: 'col_links',
    type: 'links',
    title: s.footer_links_title || 'Quick Links',
    links
  });

  // Column 3: Contact
  cols.push({
    id: 'col_contact',
    type: 'contact',
    title: s.footer_contact_title || 'Contact Us',
    content: {
      phone: s.footer_contact_phone || '+1 (800) 555-0199',
      email: s.footer_contact_email || 'support@growthos.com',
      address: s.footer_contact_address || '100 Innovation Way, San Francisco, CA'
    }
  });

  // Column 4: Newsletter
  if (s.footer_newsletter_enabled !== false) {
    cols.push({
      id: 'col_newsletter',
      type: 'newsletter',
      title: s.footer_newsletter_title || 'Newsletter',
      newsletter: {
        description: s.footer_newsletter_desc || 'Subscribe for product updates and insights.',
        placeholder: s.footer_newsletter_placeholder || 'Enter your email...',
        button_text: s.footer_newsletter_btn_text || 'Subscribe',
        success_msg: 'Thank you for subscribing!'
      }
    });
  }

  // Column 5: Social Media
  let socialList: any[] = [];
  if (Array.isArray(s.social_links) && s.social_links.length > 0) {
    socialList = s.social_links;
  } else {
    const legacySocials = (typeof s.footer_socials === 'object' && s.footer_socials !== null)
      ? s.footer_socials
      : { facebook: '#', twitter: '#', linkedin: '#' };
    socialList = Object.entries(legacySocials).map(([platform, url]) => ({
      platform,
      url: url as string,
      enabled: !!url
    }));
  }
  cols.push({
    id: 'col_social',
    type: 'social',
    title: s.footer_socials_title || 'Follow Us',
    socials: socialList
  });

  return cols;
};

// ─── Footer Renderer ────────────────────────────────────────────────────────
const FooterRenderer: React.FC<{
  section: any;
  isMobileDevice: boolean;
  onUpdateSectionSettings?: (key: string, val: any) => void;
  onOpenMediaSelector?: (callback: (url: string) => void) => void;
}> = ({ section, isMobileDevice, onUpdateSectionSettings, onOpenMediaSelector }) => {
  const s = section.settings || {};
  const bgColor = s.footer_background_color || s.background_color || '#1E293B';
  const textColor = s.footer_text_color || '#94A3B8';
  const headingColor = s.footer_heading_color || s.color || '#FFFFFF';
  const linkColor = s.footer_link_color || '#94A3B8';
  const linkHoverColor = s.footer_link_hover_color || '#6366F1';
  const fontFamily = s.footer_font_family || 'inherit';

  const logoUrl = s.footer_logo_url || s.logo_url || '';
  const logoWidth = s.footer_logo_width || '130px';
  const copyright = s.footer_copyright_text || '© 2026 GrowthOS Inc. All rights reserved.';

  const columns = getNormalizedFooterColumns(s);
  const columnCount = s.footer_columns_count || Math.min(columns.length, 6);

  const [subscribedCol, setSubscribedCol] = React.useState<{ [key: string]: boolean }>({});
  const [emailInputs, setEmailInputs] = React.useState<{ [key: string]: string }>({});
  const [activeSocialPopoverIdx, setActiveSocialPopoverIdx] = React.useState<number | null>(null);

  const handleSubscribe = (colId: string) => {
    if (!emailInputs[colId] || !emailInputs[colId].includes('@')) return;
    setSubscribedCol(prev => ({ ...prev, [colId]: true }));
  };

  const getSocialList = () => {
    const currentObj = s.footer_socials || { facebook: '#', twitter: '#', linkedin: '#' };
    if (Array.isArray(s.social_links)) return s.social_links;
    return Object.entries(currentObj).map(([platform, url]) => ({ platform, url, enabled: true }));
  };

  const handleUpdateSocialList = (newList: any[]) => {
    if (!onUpdateSectionSettings) return;
    onUpdateSectionSettings('social_links', newList);
    const obj: any = {};
    newList.forEach((item: any) => {
      if (item.enabled !== false) obj[item.platform] = item.url;
    });
    onUpdateSectionSettings('footer_socials', obj);
  };

  return (
    <footer style={{
      width: '100%',
      backgroundColor: bgColor,
      color: textColor,
      fontFamily,
      padding: s.padding || '56px 24px 28px 24px',
      margin: s.margin || '0',
      borderTop: s.border_top || '1px solid rgba(255,255,255,0.08)',
      boxSizing: 'border-box',
      position: 'relative',
      overflow: onUpdateSectionSettings ? 'visible' : 'hidden'
    }}>
      {/* Background Image / Overlay */}
      {s.footer_bg_image && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          backgroundImage: 'url(' + s.footer_bg_image + ')',
          backgroundSize: 'cover', backgroundPosition: 'center', opacity: s.footer_bg_opacity ?? 0.15,
          pointerEvents: 'none'
        }} />
      )}

      <div style={{
        maxWidth: s.max_width || '1200px',
        margin: '0 auto',
        display: 'grid',
        gridTemplateColumns: isMobileDevice ? '1fr' : 'repeat(' + columnCount + ', minmax(0, 1fr))',
        gap: s.footer_gap || '40px',
        alignItems: 'start',
        marginBottom: '44px',
        position: 'relative',
        zIndex: 2
      }}>
        {columns.map((col: any, idx: number) => {
          const colId = col.id || 'col_' + idx;
          const colTitle = col.title;

          return (
            <div key={colId} style={{ display: 'flex', flexDirection: 'column', gap: '14px', flex: col.flex || '1' }}>
              {/* Heading */}
              {colTitle && col.type !== 'brand' && (
                <h4
                  contentEditable={!!onUpdateSectionSettings}
                  suppressContentEditableWarning
                  onBlur={e => {
                    if (!onUpdateSectionSettings) return;
                    const text = e.currentTarget.innerText.trim();
                    const keyMap: any = {
                      links: 'footer_links_title',
                      contact: 'footer_contact_title',
                      newsletter: 'footer_newsletter_title',
                      social: 'footer_socials_title'
                    };
                    if (keyMap[col.type]) {
                      onUpdateSectionSettings(keyMap[col.type], text);
                    }
                  }}
                  style={{
                    margin: 0, fontSize: s.heading_font_size || '13px',
                    fontWeight: s.heading_font_weight || 700,
                    color: headingColor,
                    textTransform: (s.heading_transform as any) || 'uppercase',
                    letterSpacing: '0.08em',
                    outline: 'none',
                    cursor: onUpdateSectionSettings ? 'text' : 'inherit'
                  }}
                >
                  {colTitle}
                </h4>
              )}

              {/* Brand Column */}
              {col.type === 'brand' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {s.show_footer_logo && logoUrl ? (
                    <img
                      src={resolveAssetUrl(logoUrl)}
                      alt="Logo"
                      title={onOpenMediaSelector ? "Click to upload/change logo image" : undefined}
                      onClick={(e) => {
                        if (onOpenMediaSelector && onUpdateSectionSettings) {
                          e.stopPropagation();
                          onOpenMediaSelector((url) => onUpdateSectionSettings('footer_logo_url', url));
                        }
                      }}
                      style={{
                        width: logoWidth,
                        height: 'auto',
                        objectFit: 'contain',
                        cursor: onOpenMediaSelector ? 'pointer' : 'inherit',
                        transition: 'opacity 0.15s ease'
                      }}
                    />
                  ) : (
                    <h3
                      contentEditable={!!onUpdateSectionSettings}
                      suppressContentEditableWarning
                      onBlur={e => {
                        if (!onUpdateSectionSettings) return;
                        const text = e.currentTarget.innerText.trim();
                        onUpdateSectionSettings('footer_company_name', text);
                        onUpdateSectionSettings('footer_brand_title', text);
                        onUpdateSectionSettings('footer_logo_text', text);
                      }}
                      style={{ margin: 0, fontSize: '22px', fontWeight: 800, color: headingColor, letterSpacing: '-0.5px', outline: 'none' }}
                    >
                      {s.footer_company_name || s.footer_brand_title || colTitle || 'GrowthOS'}
                    </h3>
                  )}
                  <p
                    contentEditable={!!onUpdateSectionSettings}
                    suppressContentEditableWarning
                    onBlur={e => {
                      if (onUpdateSectionSettings) {
                        onUpdateSectionSettings('footer_tagline', e.currentTarget.innerText.trim());
                      }
                    }}
                    style={{ margin: 0, fontSize: '13px', color: textColor, lineHeight: 1.6, outline: 'none' }}
                  >
                    {s.footer_tagline || col.content?.tagline || 'Accelerating growth and pipeline velocity with modern marketing funnels.'}
                  </p>
                </div>
              )}

              {/* Links Column (Quick Links, Resources, Products, Legal) */}
              {(col.type === 'links' || col.type === 'resources' || col.type === 'products' || col.type === 'legal') && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
                  {(col.links || []).map((link: any, lIdx: number) => (
                    <div key={lIdx} style={{ display: 'inline-flex', alignItems: 'center' }}>
                      <a
                        href={link.url || '#'}
                        target={link.target || '_self'}
                        onClick={e => { if (onUpdateSectionSettings) e.preventDefault(); }}
                        style={{
                          color: link.color || linkColor,
                          fontSize: '13px',
                          textDecoration: 'none',
                          fontStyle: link.font_style || 'normal',
                          transition: 'all 0.15s ease',
                          outline: 'none'
                        }}
                        onMouseEnter={e => e.currentTarget.style.color = link.hover_color || linkHoverColor}
                        onMouseLeave={e => e.currentTarget.style.color = link.color || linkColor}
                      >
                        <span
                          contentEditable={!!onUpdateSectionSettings}
                          suppressContentEditableWarning
                          onBlur={e => {
                            if (!onUpdateSectionSettings) return;
                            const text = e.currentTarget.innerText.trim();
                            const currentLinks = [...(s.footer_links || s.links || col.links || [])];
                            if (currentLinks[lIdx]) {
                              currentLinks[lIdx] = { ...currentLinks[lIdx], label: text };
                              onUpdateSectionSettings('footer_links', currentLinks);
                              onUpdateSectionSettings('links', currentLinks);
                            }
                          }}
                        >
                          {link.label}
                        </span>
                      </a>
                    </div>
                  ))}
                </div>
              )}

              {/* Contact Column */}
              {col.type === 'contact' && (() => {
                const phone = s.footer_contact_phone || col.content?.phone;
                const email = s.footer_contact_email || col.content?.email;
                const address = s.footer_contact_address || col.content?.address;
                return (
                  <div style={{ fontSize: '13px', color: textColor, display: 'flex', flexDirection: 'column', gap: '10px', lineHeight: 1.5 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span>📞</span>
                      <span
                        contentEditable={!!onUpdateSectionSettings}
                        suppressContentEditableWarning
                        onBlur={e => onUpdateSectionSettings?.('footer_contact_phone', e.currentTarget.innerText.trim())}
                        style={{ outline: 'none' }}
                      >
                        {phone || '+1 (800) 555-0199'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span>✉️</span>
                      <span
                        contentEditable={!!onUpdateSectionSettings}
                        suppressContentEditableWarning
                        onBlur={e => onUpdateSectionSettings?.('footer_contact_email', e.currentTarget.innerText.trim())}
                        style={{ outline: 'none' }}
                      >
                        {email || 'support@growthos.com'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                      <span>📍</span>
                      <span
                        contentEditable={!!onUpdateSectionSettings}
                        suppressContentEditableWarning
                        onBlur={e => onUpdateSectionSettings?.('footer_contact_address', e.currentTarget.innerText.trim())}
                        style={{ outline: 'none' }}
                      >
                        {address || '100 Innovation Way, San Francisco, CA'}
                      </span>
                    </div>
                  </div>
                );
              })()}

              {/* Newsletter Column */}
              {col.type === 'newsletter' && (() => {
                const desc = s.footer_newsletter_desc || col.newsletter?.description;
                const placeholder = s.footer_newsletter_placeholder || col.newsletter?.placeholder || 'Enter your email...';
                const btnText = s.footer_newsletter_btn_text || col.newsletter?.button_text || 'Subscribe';
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <p
                      contentEditable={!!onUpdateSectionSettings}
                      suppressContentEditableWarning
                      onBlur={e => onUpdateSectionSettings?.('footer_newsletter_desc', e.currentTarget.innerText.trim())}
                      style={{ margin: 0, fontSize: '13px', color: textColor, lineHeight: 1.5, outline: 'none' }}
                    >
                      {desc || 'Subscribe for product updates and insights.'}
                    </p>
                    {subscribedCol[colId] ? (
                      <div style={{ padding: '10px 14px', borderRadius: '6px', background: 'rgba(34, 197, 94, 0.15)', border: '1px solid #22c55e', color: '#4ade80', fontSize: '13px', fontWeight: 600 }}>
                        ✓ {col.newsletter?.success_msg || 'Thank you for subscribing!'}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
                        <input
                          type="email"
                          placeholder={placeholder}
                          value={emailInputs[colId] || ''}
                          onChange={e => setEmailInputs({ ...emailInputs, [colId]: e.target.value })}
                          style={{
                            flex: 1, padding: '9px 12px', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px',
                            fontSize: '13px', background: 'rgba(0,0,0,0.25)', color: '#ffffff', outline: 'none'
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => handleSubscribe(colId)}
                          style={{
                            padding: '9px 16px', background: linkHoverColor, color: '#ffffff', border: 'none',
                            borderRadius: '6px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s ease'
                          }}
                        >
                          <span
                            contentEditable={!!onUpdateSectionSettings}
                            suppressContentEditableWarning
                            onBlur={e => onUpdateSectionSettings?.('footer_newsletter_btn_text', e.currentTarget.innerText.trim())}
                            style={{ outline: 'none' }}
                          >
                            {btnText}
                          </span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Social Links Column */}
              {col.type === 'social' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', position: 'relative' }}>
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                    {getSocialList().map((soc: any, sIdx: number) => {
                      if (soc.enabled === false) return null;
                      const isPopoverOpen = activeSocialPopoverIdx === sIdx;

                      return (
                        <div key={sIdx} style={{ position: 'relative' }}>
                          <a
                            href={soc.url || '#'}
                            target={soc.target || '_blank'}
                            rel="noreferrer"
                            onClick={(e) => {
                              if (onUpdateSectionSettings) {
                                e.preventDefault();
                                e.stopPropagation();
                                setActiveSocialPopoverIdx(isPopoverOpen ? null : sIdx);
                              }
                            }}
                            title={onUpdateSectionSettings ? "Click to change icon or social URL" : undefined}
                            style={{
                              width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(255,255,255,0.08)',
                              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                              color: headingColor, textDecoration: 'none', transition: 'all 0.2s ease',
                              border: isPopoverOpen ? `2px solid ${linkHoverColor}` : '1px solid rgba(255,255,255,0.12)',
                              cursor: onUpdateSectionSettings ? 'pointer' : 'pointer'
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = linkHoverColor; e.currentTarget.style.borderColor = linkHoverColor; }}
                            onMouseLeave={e => { if (!isPopoverOpen) { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; } }}
                          >
                            {renderFooterSocialSvg(soc.platform, headingColor, 16)}
                          </a>

                          {/* Interactive Popover overlay to edit platform & link */}
                          {isPopoverOpen && onUpdateSectionSettings && (
                            <div
                              onClick={(e) => e.stopPropagation()}
                              style={{
                                position: 'absolute',
                                top: '44px',
                                right: 0,
                                left: 'auto',
                                zIndex: 9999,
                                background: '#ffffff',
                                color: '#1e293b',
                                borderRadius: '10px',
                                padding: '14px',
                                boxShadow: '0 12px 32px rgba(0,0,0,0.35)',
                                width: '250px',
                                minWidth: '250px',
                                fontSize: '12px',
                                border: '1px solid #cbd5e1',
                                boxSizing: 'border-box'
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', fontWeight: 700, fontSize: '13px', color: '#0f172a' }}>
                                <span>Edit Social Channel</span>
                                <button type="button" onClick={() => setActiveSocialPopoverIdx(null)} style={{ border: 'none', background: '#f1f5f9', width: '22px', height: '22px', borderRadius: '50%', cursor: 'pointer', fontSize: '14px', color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
                              </div>

                              <div style={{ marginBottom: '10px' }}>
                                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, marginBottom: '4px', color: '#475569' }}>Icon / Platform</label>
                                <select
                                  value={soc.platform || 'facebook'}
                                  onChange={e => {
                                    const list = [...getSocialList()];
                                    list[sIdx] = { ...list[sIdx], platform: e.target.value };
                                    handleUpdateSocialList(list);
                                  }}
                                  style={{ width: '100%', padding: '7px 9px', fontSize: '12px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#f8fafc', color: '#0f172a', boxSizing: 'border-box' }}
                                >
                                  <option value="facebook">Facebook</option>
                                  <option value="twitter">X / Twitter</option>
                                  <option value="linkedin">LinkedIn</option>
                                  <option value="instagram">Instagram</option>
                                  <option value="youtube">YouTube</option>
                                  <option value="github">GitHub</option>
                                  <option value="tiktok">TikTok</option>
                                  <option value="whatsapp">WhatsApp</option>
                                  <option value="discord">Discord</option>
                                </select>
                              </div>

                              <div style={{ marginBottom: '12px' }}>
                                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, marginBottom: '4px', color: '#475569' }}>Social URL / Link</label>
                                <input
                                  placeholder="https://..."
                                  value={soc.url || ''}
                                  onChange={e => {
                                    const list = [...getSocialList()];
                                    list[sIdx] = { ...list[sIdx], url: e.target.value };
                                    handleUpdateSocialList(list);
                                  }}
                                  style={{ width: '100%', padding: '7px 9px', fontSize: '12px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#f8fafc', color: '#0f172a', boxSizing: 'border-box' }}
                                />
                              </div>

                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const list = getSocialList().filter((_: any, i: number) => i !== sIdx);
                                    handleUpdateSocialList(list);
                                    setActiveSocialPopoverIdx(null);
                                  }}
                                  style={{ border: 'none', background: '#fee2e2', color: '#991b1b', padding: '6px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, cursor: 'pointer', flex: 1 }}
                                >
                                  Delete Icon
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setActiveSocialPopoverIdx(null)}
                                  style={{ border: 'none', background: '#4f46e5', color: '#ffffff', padding: '6px 12px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, cursor: 'pointer', flex: 1 }}
                                >
                                  Done
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {onUpdateSectionSettings && (
                      <button
                        type="button"
                        onClick={() => {
                          const list = [...getSocialList(), { platform: 'instagram', url: 'https://instagram.com', enabled: true }];
                          handleUpdateSocialList(list);
                          setActiveSocialPopoverIdx(list.length - 1);
                        }}
                        style={{
                          height: '36px',
                          padding: '0 12px',
                          borderRadius: '8px',
                          background: 'rgba(255,255,255,0.06)',
                          border: '1.5px dashed rgba(255,255,255,0.25)',
                          color: headingColor,
                          fontSize: '11px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          transition: 'all 0.15s ease'
                        }}
                        onMouseEnter={e => e.currentTarget.style.borderColor = linkHoverColor}
                        onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.25)'}
                      >
                        + Add Icon
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Custom HTML Column */}
              {col.type === 'custom' && (
                <div style={{ fontSize: '13px', color: textColor }} dangerouslySetInnerHTML={{ __html: col.content?.custom_html || '' }} />
              )}
            </div>
          );
        })}
      </div>

      {/* Bottom Bar Divider & Copyright */}
      <div style={{
        maxWidth: s.max_width || '1200px',
        margin: '0 auto',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        paddingTop: '24px',
        display: 'flex',
        flexDirection: isMobileDevice ? 'column' : 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '12px',
        fontSize: '12px',
        color: textColor,
        position: 'relative',
        zIndex: 2
      }}>
        <div
          contentEditable={!!onUpdateSectionSettings}
          suppressContentEditableWarning
          onBlur={e => onUpdateSectionSettings?.('footer_copyright_text', e.currentTarget.innerText.trim())}
          style={{ outline: 'none' }}
        >
          {copyright}
        </div>
        {s.footer_legal_links && s.footer_legal_links.length > 0 && (
          <div style={{ display: 'flex', gap: '16px' }}>
            {s.footer_legal_links.map((l: any, idx: number) => (
              <a key={idx} href={l.url || '#'} style={{ color: linkColor, textDecoration: 'none' }}>{l.label}</a>
            ))}
          </div>
        )}
      </div>
    </footer>
  );
};

interface NumericSliderInputProps {
  label: string;
  value: number | string | undefined;
  onChange: (val: any) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  onBlur?: () => void;
  allowedUnits?: string[];
}

const NumericSliderInput: React.FC<NumericSliderInputProps> = ({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  unit = 'px',
  onBlur,
  allowedUnits
}) => {
  const detectAndParse = (v: any) => {
    if (v === undefined || v === null || v === '') return { val: 0, unit: unit || 'px' };
    const str = String(v).trim().toLowerCase();
    if (str === 'auto') return { val: 0, unit: 'auto' };
    if (str === 'fit-content') return { val: 0, unit: 'fit-content' };
    const num = parseFloat(str);
    if (isNaN(num)) return { val: 0, unit: unit || 'px' };
    const u = str.replace(String(num), '').trim();
    return { val: num, unit: u || unit || 'px' };
  };

  const parsed = detectAndParse(value);
  const val = parsed.val;
  const currentUnit = parsed.unit;

  const isKeyword = currentUnit === 'auto' || currentUnit === 'fit-content';

  const handleValChange = (newVal: number) => {
    let finalVal = newVal;
    if (min !== undefined && newVal < min) finalVal = min;
    if (max !== undefined && newVal > max) finalVal = max;

    if (allowedUnits && allowedUnits.length > 0) {
      onChange(finalVal + currentUnit);
    } else {
      onChange(finalVal);
    }
  };

  const handleUnitChange = (newUnit: string) => {
    if (newUnit === 'auto' || newUnit === 'fit-content') {
      onChange(newUnit);
    } else {
      onChange(val + newUnit);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <label style={{ fontSize: '11px', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {!isKeyword && (
            <input
              type="number"
              min={min}
              max={max}
              step={step}
              value={val}
              onChange={e => handleValChange(Number(e.target.value))}
              onBlur={onBlur}
              style={{
                width: '50px',
                border: '1px solid #CBD5E1',
                borderRadius: '4px',
                padding: '2px 4px',
                background: '#FFFFFF',
                fontSize: '11px',
                fontWeight: 700,
                textAlign: 'right',
                outline: 'none',
                color: '#1E293B'
              }}
            />
          )}
          {allowedUnits && allowedUnits.length > 0 ? (
            <select
              value={currentUnit}
              onChange={e => handleUnitChange(e.target.value)}
              style={{
                border: '1px solid #CBD5E1',
                borderRadius: '4px',
                padding: '2px 4px',
                background: '#F1F5F9',
                fontSize: '10px',
                fontWeight: 600,
                color: '#475569',
                outline: 'none'
              }}
            >
              {allowedUnits.map(u => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          ) : (
            <span style={{ fontSize: '10px', color: '#64748B', fontWeight: 600 }}>{currentUnit}</span>
          )}
        </div>
      </div>
      {!isKeyword && (
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={val}
          onChange={e => handleValChange(Number(e.target.value))}
          onMouseUp={onBlur}
          onTouchEnd={onBlur}
          style={{ width: '100%', cursor: 'pointer', accentColor: '#6366F1' }}
        />
      )}
    </div>
  );
};

const renderColorPickerField = (
  label: string,
  value: string | undefined,
  defaultValue: string,
  onChange: (val: string) => void,
  noColorValue: string = 'transparent'
) => {
  const isNoColor = value === noColorValue;
  return (
    <div className={styles.fieldGroup}>
      <label>{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <input
          type="color"
          disabled={isNoColor}
          value={value && !isNoColor ? value : defaultValue}
          onChange={e => onChange(e.target.value)}
          style={{ cursor: isNoColor ? 'not-allowed' : 'pointer' }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', cursor: 'pointer', margin: 0, fontWeight: 'normal', userSelect: 'none' }}>
          <input
            type="checkbox"
            checked={isNoColor}
            onChange={e => onChange(e.target.checked ? noColorValue : defaultValue)}
          />
          No Color
        </label>
      </div>
    </div>
  );
};

const renderLinkSettingsPanel = (cfg: any, onUpdate: (key: string, val: any) => void) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #E2E8F0' }}>
    <label style={{ fontSize: '11px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em' }}>🔗 Hyperlink / Redirect Settings</label>
    <div className={styles.fieldGroup}>
      <label>Link URL</label>
      <input placeholder="https://example.com or #section-id" value={cfg.link_url || ''} onChange={e => onUpdate('link_url', e.target.value)} />
    </div>
    {cfg.link_url && (
      <>
        <div className={styles.fieldGroup}>
          <label>Target Window</label>
          <select value={cfg.link_target || '_self'} onChange={e => onUpdate('link_target', e.target.value)}>
            <option value="_self">Open in Same Tab (_self)</option>
            <option value="_blank">Open in New Tab (_blank)</option>
          </select>
        </div>
        <div className={styles.fieldGroup}>
          <label>Rel Attributes</label>
          <select value={cfg.link_rel || 'none'} onChange={e => onUpdate('link_rel', e.target.value)}>
            <option value="none">Standard Link</option>
            <option value="nofollow">Nofollow (SEO)</option>
            <option value="sponsored">Sponsored (Ad Link)</option>
          </select>
        </div>
        <div className={styles.fieldGroup}>
          <label>Underline Style</label>
          <select value={cfg.link_underline || 'underline'} onChange={e => onUpdate('link_underline', e.target.value)}>
            <option value="underline">Always Underlined</option>
            <option value="hover">Underline on Hover</option>
            <option value="none">No Underline</option>
          </select>
        </div>
        {renderColorPickerField('Custom Link Color', cfg.link_color, '#4F46E5', (val) => onUpdate('link_color', val))}
        {renderColorPickerField('Hover Link Color', cfg.link_hover_color, '#3730A3', (val) => onUpdate('link_hover_color', val))}
        <div className={styles.fieldGroup}>
          <label>Aria Label (Accessibility)</label>
          <input placeholder="e.g. Read full article" value={cfg.link_aria_label || ''} onChange={e => onUpdate('link_aria_label', e.target.value)} />
        </div>
      </>
    )}
  </div>
);

export const FunnelsPage = () => {
  const getColumnWidthStyle = (widthStr?: string, cIdx: number = 0, viewMode: string = 'desktop'): React.CSSProperties => {
    if (viewMode === 'mobile') {
      return { flex: '1 1 100%', width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' };
    }
    const w = widthStr || '';
    const str = String(w).trim().toLowerCase();
    if (str === '100%' || str === '1/1' || str.includes('100')) {
      return { flex: '1 1 100%', width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' };
    }
    if (str === '50/50' || str === '1/2' || str.includes('50')) {
      return { flex: '1 1 0%', width: '50%', maxWidth: '50%', minWidth: 0, boxSizing: 'border-box' };
    }
    if (str === '1/3' || str === '33/33/33' || str.includes('33') || str.includes('1/3')) {
      return { flex: '1 1 0%', width: '33.3333%', maxWidth: '33.3333%', minWidth: 0, boxSizing: 'border-box' };
    }
    if (str === '1/4' || str === '25/25/25/25' || str.includes('25') || str.includes('1/4')) {
      return { flex: '1 1 0%', width: '25%', maxWidth: '25%', minWidth: 0, boxSizing: 'border-box' };
    }
    if (str === '1/5' || str.includes('20') || str.includes('1/5')) {
      return { flex: '1 1 0%', width: '20%', maxWidth: '20%', minWidth: 0, boxSizing: 'border-box' };
    }
    if (str === '25/75') {
      const pct = cIdx === 0 ? '25%' : '75%';
      return { flex: cIdx === 0 ? '1 1 25%' : '3 3 75%', width: pct, maxWidth: pct, minWidth: 0, boxSizing: 'border-box' };
    }
    if (str === '75/25') {
      const pct = cIdx === 0 ? '75%' : '25%';
      return { flex: cIdx === 0 ? '3 3 75%' : '1 1 25%', width: pct, maxWidth: pct, minWidth: 0, boxSizing: 'border-box' };
    }
    return { flex: '1 1 0%', minWidth: 0, maxWidth: '100%', boxSizing: 'border-box' };
  };

  const getCanvasSectionStyle = (sec: any, sIdx: number): React.CSSProperties => {
    const s = sec.settings || {};
    const sectionHeight = s.height_type === 'custom-px' ? `${s.height_value || 400}px` :
      s.height_type === 'vh' ? `${s.height_value || 100}vh` :
        s.height_type === 'percent' ? `${s.height_value || 100}%` :
          s.height_type === 'fit-content' ? 'fit-content' : 'auto';
    const sectionMinHeight = s.min_height_type === 'custom-px' ? `${s.min_height_value || 0}px` :
      s.min_height_type === 'vh' ? `${s.min_height_value || 0}vh` :
        s.min_height_type === 'percent' ? `${s.min_height_value || 0}%` : '0px';
    const sectionPadding = (s.padding_top !== undefined || s.padding_bottom !== undefined || s.padding_left !== undefined || s.padding_right !== undefined)
      ? `${s.padding_top || '0px'} ${s.padding_right || '0px'} ${s.padding_bottom || '0px'} ${s.padding_left || '0px'}`
      : (sec.type === 'Navbar' ? '0' : (s.padding || '40px 0'));
    const sectionMargin = (s.margin_top !== undefined || s.margin_bottom !== undefined || s.margin_left !== undefined || s.margin_right !== undefined)
      ? `${s.margin_top || '0px'} ${s.margin_right || '0px'} ${s.margin_bottom || '0px'} ${s.margin_left || '0px'}`
      : (s.margin || '0px');
    return {
      ...(dragOverSectionIndex === sIdx && draggedSectionIndex !== sIdx ? {
        borderTop: draggedSectionIndex! > sIdx ? '3px solid #6366f1' : 'none',
        borderBottom: draggedSectionIndex! < sIdx ? '3px solid #6366f1' : 'none',
        backgroundColor: '#f1f5f9',
        transition: 'all 0.15s ease'
      } : {}),
      height: sectionHeight,
      minHeight: sectionMinHeight,
      width: '100%',
      maxWidth: '100%',
      boxSizing: 'border-box',
      padding: sectionPadding,
      margin: sectionMargin,
      overflow: s.overflow || 'hidden',
      position: 'relative',
      background: s.transparent ? 'transparent' : (s.background_color || '#ffffff')
    };
  };


  const [funnels, setFunnels] = useState<Funnel[]>([]);
  const [openInspectorGroups, setOpenInspectorGroups] = useState<Record<string, boolean>>({
    layout: true,
    style: true,
    typography: true,
    advanced: false
  });
  const [forms, setForms] = useState<Form[]>([]);
  const [formFieldsMap, setFormFieldsMap] = useState<Record<string, FormField[]>>({});
  const [selectedFunnel, setSelectedFunnel] = useState<Funnel | null>(null);
  const [steps, setSteps] = useState<FunnelStep[]>([]);
  const [analytics, setAnalytics] = useState<FunnelAnalytics | null>(null);
  const [activeTab, setActiveTab] = useState<TabView>('builder');
  const [editingStep, setEditingStep] = useState<FunnelStep | null>(null);
  const [copied, setCopied] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [savingStep, setSavingStep] = useState(false);
  const [addingStep, setAddingStep] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastIdRef = useRef(0);

  // ─── Asset Library & Media Upload State
  const [mediaLibrary, setMediaLibrary] = useState<any[]>([]);
  const [isMediaModalOpen, setIsMediaModalOpen] = useState(false);
  const [onSelectMediaCallback, setOnSelectMediaCallback] = useState<((url: string) => void) | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // QoL component search & recently used states
  const [recentlyUsedComponents, setRecentlyUsedComponents] = useState<string[]>(['Heading', 'Paragraph', 'Button', 'Image', 'Video']);
  const [activeSearchCol, setActiveSearchCol] = useState<{ sIdx: number; rIdx: number; cIdx: number } | null>(null);
  const [compSearchTerm, setCompSearchTerm] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; type: 'section' | 'row' | 'column' | 'component'; sIdx: number; rIdx?: number; cIdx?: number; index?: number } | null>(null);

  // Global window dismiss listener for custom context menu
  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, []);

  // ─── Create funnel modal
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createModalStep, setCreateModalStep] = useState<'gallery' | 'details'>('gallery');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('blank');
  const [newFunnel, setNewFunnel] = useState({ name: '', description: '', type: 'Lead', is_active: true });
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);

  // Drag and Drop reordering states
  const [draggedSectionIndex, setDraggedSectionIndex] = useState<number | null>(null);
  const [dragOverSectionIndex, setDragOverSectionIndex] = useState<number | null>(null);

  // ─── Create step modal
  const [isStepModalOpen, setIsStepModalOpen] = useState(false);
  const [newStep, setNewStep] = useState<Partial<FunnelStep>>({ name: '', order: 1 });

  // ─── Active components editing state
  const [stepComponents, setStepComponents] = useState<Partial<FunnelComponent>[]>([]);
  const [editingComponentIndex, setEditingComponentIndex] = useState<number | null>(null);

  // ─── Section-Based Responsive Builder States
  const [pageLayout, setPageLayout] = useState<any>(null);
  const [activeElement, setActiveElement] = useState<{ type: 'page' | 'section' | 'row' | 'column' | 'component'; id: string; sectionIndex?: number; rowIndex?: number; columnIndex?: number; index?: number } | null>({ type: 'page', id: 'page' });
  const [activeViewMode, setActiveViewMode] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isAutosaveRestorable, setIsAutosaveRestorable] = useState(false);
  const [restorableLayout, setRestorableLayout] = useState<any>(null);
  const [autosavePillStatus, setAutosavePillStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved');

  // UX Collapsible side panels states
  const [isLayersOpen, setIsLayersOpen] = useState(false);
  const [isInspectorOpen, setIsInspectorOpen] = useState(true);
  const [isSectionLibraryModalOpen, setIsSectionLibraryModalOpen] = useState(false);
  const [sectionSearchQuery, setSectionSearchQuery] = useState('');

  // Media Library search/filter/sort state
  const [mediaSearchQuery, setMediaSearchQuery] = useState('');
  const [mediaTypeFilter, setMediaTypeFilter] = useState<'all' | 'image' | 'video'>('all');
  const [mediaSortOrder, setMediaSortOrder] = useState<'newest' | 'oldest' | 'name'>('newest');

  const workspaceCanvasRef = useRef<HTMLDivElement>(null);
  const [canvasContainerWidth, setCanvasContainerWidth] = useState<number>(1200);

  // ResizeObserver for canvas scaling
  useEffect(() => {
    if (!editingStep) return;
    const el = workspaceCanvasRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0) return;
      const width = entries[0].contentRect.width;
      setCanvasContainerWidth(width);
    });

    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [editingStep]);

  const getScaleFactor = () => {
    const padding = 32;
    const avail = Math.max(canvasContainerWidth - padding, 200);
    const target = activeViewMode === 'mobile' ? 375 : activeViewMode === 'tablet' ? 768 : 1080;
    if (avail < target) {
      return Math.max(avail / target, 0.88);
    }
    return 1;
  };
  const canvasScale = getScaleFactor();

  // Automatically collapse side panels in mobile view mode
  useEffect(() => {
    if (activeViewMode === 'mobile') {
      setIsLayersOpen(false);
      setIsInspectorOpen(false);
    }
  }, [activeViewMode]);

  // Contextually open properties inspector when activeElement is selected in desktop mode
  useEffect(() => {
    if (activeElement && activeViewMode !== 'mobile') {
      setIsInspectorOpen(true);
    }
  }, [activeElement, activeViewMode]);

  useEffect(() => { fetchFunnels(); fetchForms(); fetchTeamMembers(); }, []);

  // ─── Toast helpers ────────────────────────────────────────────────────────
  const showToast = useCallback((message: string, type: ToastType = 'success') => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // ─── Data fetching ────────────────────────────────────────────────────────
  const fetchFunnels = async () => {
    try { setFunnels(await funnelsApi.getFunnels()); } catch { }
  };

  const fetchForms = async () => {
    try {
      const list = await formsApi.getForms();
      setForms(list);
      const map: Record<string, FormField[]> = {};
      await Promise.all(
        list.map(async (f) => {
          try {
            const fields = await formsApi.getFields(f.id);
            map[f.id] = fields;
          } catch { }
        })
      );
      setFormFieldsMap(map);
    } catch { }
  };

  const fetchTeamMembers = async () => {
    try { setTeamMembers(await teamApi.getTeamMembers()); } catch { }
  };

  const fetchMediaLibrary = async () => {
    try {
      const data = await funnelsApi.getMediaLibrary();
      setMediaLibrary(data);
    } catch { }
  };

  const handleSelectFunnel = async (funnel: Funnel) => {
    try {
      const full = await funnelsApi.getFunnel(funnel.id);
      setSelectedFunnel(full);
      const sorted = (full.steps || []).sort((a, b) => a.order - b.order);
      setSteps(sorted);
      setEditingStep(null);
      setActiveTab('builder');
      setAnalytics(null);
      fetchMediaLibrary();
    } catch {
      showToast('Failed to load funnel details.', 'error');
    }
  };

  // ─── Funnel CRUD ──────────────────────────────────────────────────────────
  const handleCreateFunnel = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const created = await funnelsApi.createFunnel(newFunnel);
      setFunnels(prev => [...prev, created]);

      // Auto-create steps based on selected template blueprint
      const template = FUNNEL_TEMPLATES.find(t => t.id === selectedTemplateId) || FUNNEL_TEMPLATES[0];
      const firstFormId = forms[0]?.id || '';
      const firstCalendarId = teamMembers[0]?.id || '';

      for (let i = 0; i < template.steps.length; i++) {
        const stepName = template.steps[i];
        const layout = generateTemplateLayout(template.name, stepName, firstFormId, firstCalendarId);
        const stepPayload = {
          name: stepName,
          order: i + 1,
          page_content: layout
        };
        await funnelsApi.createStep(created.id, stepPayload);
      }

      setIsCreateModalOpen(false);
      setCreateModalStep('gallery');
      setSelectedTemplateId('blank');
      setNewFunnel({ name: '', description: '', type: 'Lead', is_active: true });
      showToast(`Funnel created successfully with ${template.steps.length} ${template.steps.length === 1 ? 'step' : 'steps'}!`);
      handleSelectFunnel(created);
    } catch (err: any) {
      showToast(err.message || 'Failed to create funnel.', 'error');
    }
  };

  const handleDeleteFunnel = async () => {
    if (!selectedFunnel || !window.confirm('Delete this funnel?')) return;
    try {
      await funnelsApi.deleteFunnel(selectedFunnel.id);
      setFunnels(prev => prev.filter(f => f.id !== selectedFunnel.id));
      setSelectedFunnel(null);
      setSteps([]);
      showToast('Funnel deleted.');
    } catch (err: any) {
      showToast(err.message || 'Failed to delete funnel.', 'error');
    }
  };

  const handlePublish = async () => {
    if (!selectedFunnel) return;
    setPublishing(true);
    try {
      const updated = await funnelsApi.publishFunnel(selectedFunnel.id);
      setSelectedFunnel(updated);
      setFunnels(prev => prev.map(f => f.id === updated.id ? updated : f));
      showToast('Funnel published! Your URL is now live.');
    } catch (err: any) {
      showToast(err.message || 'Failed to publish funnel.', 'error');
    } finally { setPublishing(false); }
  };

  const handleUnpublish = async () => {
    if (!selectedFunnel) return;
    setPublishing(true);
    try {
      const updated = await funnelsApi.unpublishFunnel(selectedFunnel.id);
      setSelectedFunnel(updated);
      setFunnels(prev => prev.map(f => f.id === updated.id ? updated : f));
      showToast('Funnel unpublished and set to Draft.');
    } catch (err: any) {
      showToast(err.message || 'Failed to unpublish funnel.', 'error');
    } finally { setPublishing(false); }
  };

  const getFullPublishedUrl = (url?: string | null): string => {
    if (!url) return '';
    const trimmed = url.trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return trimmed;
    }
    const cleanPath = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    return `${window.location.origin}${cleanPath}`;
  };

  const handleCopyLink = () => {
    if (!selectedFunnel?.published_url) return;
    const full = getFullPublishedUrl(selectedFunnel.published_url);
    navigator.clipboard.writeText(full).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      showToast('Link copied to clipboard!');
    });
  };

  // ─── Step CRUD ────────────────────────────────────────────────────────────
  const handleCreateStep = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFunnel || addingStep) return;
    if (!newStep.name || !newStep.name.trim()) {
      showToast('Step name/type is required.', 'error');
      return;
    }
    setAddingStep(true);
    try {
      const defaultLayout = generateTemplateLayout(selectedFunnel.type === 'Appointment' ? 'Appointment Booking' : 'Lead Generation', newStep.name || 'Landing Page', forms[0]?.id, teamMembers[0]?.id);
      const created = await funnelsApi.createStep(selectedFunnel.id, {
        ...newStep,
        order: steps.length + 1,
        page_content: defaultLayout
      });
      setSteps(prev => [...prev, created].sort((a, b) => a.order - b.order));
      setIsStepModalOpen(false);
      setNewStep({ name: '', order: steps.length + 2 });
      showToast(`Step "${created.name}" added.`);
    } catch (err: any) {
      showToast(err.message || 'Failed to add step.', 'error');
    } finally { setAddingStep(false); }
  };

  const handleMoveStep = async (index: number, direction: 'up' | 'down') => {
    if (!selectedFunnel) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= steps.length) return;

    const newSteps = [...steps];
    const item1 = newSteps[index];
    const item2 = newSteps[targetIndex];

    newSteps[index] = item2;
    newSteps[targetIndex] = item1;

    const updatedSteps = newSteps.map((s, idx) => ({
      ...s,
      order: idx + 1
    }));

    setSteps(updatedSteps);

    try {
      await Promise.all([
        funnelsApi.updateStep(selectedFunnel.id, item1.id, { order: targetIndex + 1 }),
        funnelsApi.updateStep(selectedFunnel.id, item2.id, { order: index + 1 })
      ]);
      showToast('Step order updated.');
    } catch (err: any) {
      showToast(err.message || 'Failed to reorder step.', 'error');
      try {
        const refreshed = await funnelsApi.getSteps(selectedFunnel.id);
        setSteps(refreshed.sort((a, b) => a.order - b.order));
      } catch { }
    }
  };

  const handleDuplicateStep = async (step: FunnelStep) => {
    if (!selectedFunnel) return;
    try {
      const duplicated = await funnelsApi.duplicateStep(selectedFunnel.id, step.id);
      setSteps(prev => [...prev, duplicated].sort((a, b) => a.order - b.order));
      showToast(`Step "${step.name}" duplicated.`);
    } catch (err: any) {
      showToast(err.message || 'Failed to duplicate step.', 'error');
    }
  };

  const handleDeleteStep = async (stepId: string) => {
    if (!selectedFunnel) return;
    if (!window.confirm('Are you sure you want to delete this step?')) return;
    try {
      await funnelsApi.deleteStep(selectedFunnel.id, stepId);
      setSteps(prev => prev.filter(s => s.id !== stepId));
      if (editingStep?.id === stepId) {
        setEditingStep(null);
      }
      showToast('Step deleted.');
    } catch (err: any) {
      showToast(err.message || 'Failed to delete step.', 'error');
    }
  };

  // ─── Builder Layout Management Helpers ─────────────────────────────────────
  const updateLayoutState = (newLayout: any, skipHistory = false) => {
    setPageLayout(newLayout);
    setAutosavePillStatus('unsaved');

    if (editingStep) {
      localStorage.setItem(`growthos_funnel_step_draft_${editingStep.id}`, JSON.stringify(newLayout));
    }

    if (!skipHistory) {
      const nextHistory = history.slice(0, historyIndex + 1);
      nextHistory.push(newLayout);
      setHistory(nextHistory);
      setHistoryIndex(nextHistory.length - 1);
    }
  };

  const commitToHistory = () => {
    if (!pageLayout) return;
    if (historyIndex >= 0 && historyIndex < history.length) {
      if (JSON.stringify(history[historyIndex]) === JSON.stringify(pageLayout)) {
        return;
      }
    }
    const nextHistory = history.slice(0, historyIndex + 1);
    nextHistory.push(JSON.parse(JSON.stringify(pageLayout)));
    setHistory(nextHistory);
    setHistoryIndex(nextHistory.length - 1);
  };

  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      setHistoryIndex(prev => prev - 1);
      setPageLayout(history[historyIndex - 1]);
    }
  }, [history, historyIndex]);

  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(prev => prev + 1);
      setPageLayout(history[historyIndex + 1]);
    }
  }, [history, historyIndex]);

  // Keyboard shortcuts – stored in a ref so forward-declared helpers are visible
  const keyboardHandlersRef = useRef<{
    deleteComponent?: (sIdx: number, rIdx: number, cIdx: number, idx: number) => void;
    deleteRow?: (sIdx: number, rIdx: number) => void;
    deleteSection?: (sIdx: number) => void;
    duplicateComponent?: (sIdx: number, rIdx: number, cIdx: number, idx: number) => void;
    duplicateSection?: (sIdx: number) => void;
  }>({});

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!editingStep) return;

      // Ctrl+Z / Ctrl+Shift+Z (Undo/Redo)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }

      // Safeguard input fields from delete/duplicate triggers
      const activeTag = document.activeElement?.tagName;
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || document.activeElement?.getAttribute('contenteditable') === 'true') {
        return;
      }

      const { deleteComponent: dc, deleteRow: dr, deleteSection: ds, duplicateComponent: dup, duplicateSection: dups } = keyboardHandlersRef.current;

      // Delete active element
      if (e.key === 'Delete') {
        e.preventDefault();
        if (activeElement) {
          if (activeElement.type === 'component' && activeElement.sectionIndex !== undefined && activeElement.rowIndex !== undefined && activeElement.columnIndex !== undefined && activeElement.index !== undefined) {
            dc?.(activeElement.sectionIndex, activeElement.rowIndex, activeElement.columnIndex, activeElement.index);
          } else if (activeElement.type === 'row' && activeElement.sectionIndex !== undefined && activeElement.rowIndex !== undefined) {
            dr?.(activeElement.sectionIndex, activeElement.rowIndex);
          } else if (activeElement.type === 'section' && activeElement.sectionIndex !== undefined) {
            ds?.(activeElement.sectionIndex);
          }
        }
        return;
      }

      // Ctrl+D (Duplicate active element)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        if (activeElement) {
          if (activeElement.type === 'component' && activeElement.sectionIndex !== undefined && activeElement.rowIndex !== undefined && activeElement.columnIndex !== undefined && activeElement.index !== undefined) {
            dup?.(activeElement.sectionIndex, activeElement.rowIndex, activeElement.columnIndex, activeElement.index);
          } else if (activeElement.type === 'section' && activeElement.sectionIndex !== undefined) {
            dups?.(activeElement.sectionIndex);
          }
        }
        return;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editingStep, handleUndo, handleRedo, activeElement]);

  // Periodic autosave to database (every 30 seconds if changed)
  useEffect(() => {
    if (!editingStep || !selectedFunnel || !pageLayout) return;
    const interval = setInterval(async () => {
      const draftKey = `growthos_funnel_step_draft_${editingStep.id}`;
      const savedLayout = localStorage.getItem(draftKey);
      if (savedLayout) {
        try {
          setAutosavePillStatus('saving');
          const payload = {
            ...editingStep,
            form_id: editingStep.form_id || null,
            page_content: savedLayout
          };
          await funnelsApi.updateStep(selectedFunnel.id, editingStep.id, payload);
          setAutosavePillStatus('saved');
        } catch {
          setAutosavePillStatus('unsaved');
        }
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [editingStep, selectedFunnel, pageLayout]);

  const addSection = (type: string) => {
    let rows: any[] = [];
    const secId = `sec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    let bgCol = '#ffffff';

    const makeId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    if (type === 'Navbar') {
      rows = [{
        id: makeId('row'),
        settings: {},
        columns: [
          {
            id: makeId('col'),
            width: '1/4',
            settings: {},
            components: [{ id: makeId('comp'), type: 'Heading', config: JSON.stringify({ text: '🚀 GrowthOS', level: 'h3', align: 'left', color: '#4F46E5' }) }]
          },
          {
            id: makeId('col'),
            width: '1/2',
            settings: {},
            components: [{ id: makeId('comp'), type: 'Paragraph', config: JSON.stringify({ text: 'Features   •   Pricing   •   Testimonials   •   FAQ', align: 'center', color: '#475569' }) }]
          },
          {
            id: makeId('col'),
            width: '1/4',
            settings: {},
            components: [{ id: makeId('comp'), type: 'Button', config: JSON.stringify({ text: 'Try Free', size: 'small', alignment: 'right', style: 'primary', color: '#4F46E5', text_color: '#FFFFFF', border_radius: '6px' }) }]
          }
        ]
      }];
    } else if (type === 'Footer') {
      bgCol = '#1E293B';
      rows = [{
        id: makeId('row'),
        settings: {},
        columns: [
          {
            id: makeId('col'),
            width: '1/2',
            settings: {},
            components: [
              { id: makeId('comp'), type: 'Heading', config: JSON.stringify({ text: 'GrowthOS Sales CRM', level: 'h3', align: 'left', color: '#FFFFFF' }) },
              { id: makeId('comp'), type: 'Paragraph', config: JSON.stringify({ text: 'The modern SaaS suite for pipeline velocity and automated scheduling.', align: 'left', color: '#94A3B8' }) }
            ]
          },
          {
            id: makeId('col'),
            width: '1/2',
            settings: {},
            components: [
              { id: makeId('comp'), type: 'Paragraph', config: JSON.stringify({ text: '© 2026 GrowthOS Inc. All rights reserved.', align: 'right', color: '#94A3B8' }) },
              { id: makeId('comp'), type: 'SocialLinks', config: JSON.stringify({ align: 'right', facebook: '#', twitter: '#', linkedin: '#' }) }
            ]
          }
        ]
      }];
    } else if (type === 'Hero') {
      rows = [{
        id: makeId('row'),
        settings: {},
        columns: [{
          id: makeId('col'),
          width: '100%',
          settings: {},
          components: [
            { id: makeId('comp'), type: 'Heading', config: JSON.stringify({ text: 'Supercharge Your GrowthOS Sales Funnels', level: 'h1', align: 'center', color: '#4F46E5' }) },
            { id: makeId('comp'), type: 'Paragraph', config: JSON.stringify({ text: 'Convert more traffic into leads, bookings, and recurring revenue with a unified responsive CRM sales suite.', align: 'center', color: '#4B5563' }) },
            { id: makeId('comp'), type: 'Button', config: JSON.stringify({ text: 'Get Started Risk-Free', size: 'large', alignment: 'center', style: 'primary', color: '#4F46E5', text_color: '#FFFFFF', border_radius: '8px', icon_name: 'ArrowRight' }) }
          ]
        }]
      }];
    } else if (type === 'About') {
      rows = [{
        id: makeId('row'),
        settings: {},
        columns: [{
          id: makeId('col'),
          width: '100%',
          settings: {},
          components: [
            { id: makeId('comp'), type: 'Heading', config: JSON.stringify({ text: 'Designed by Senior SaaS CRM Architects', level: 'h2', align: 'center', color: '#111827' }) },
            { id: makeId('comp'), type: 'Paragraph', config: JSON.stringify({ text: 'GrowthOS CRM is designed to streamline your business pipelines, simplify client scheduling, and eliminate duplicate entries across your workspaces seamlessly.', align: 'center', color: '#4B5563' }) }
          ]
        }]
      }];
    } else if (type === 'Features') {
      rows = [{
        id: makeId('row'),
        settings: {},
        columns: [
          {
            id: makeId('col'),
            width: '1/3',
            settings: {},
            components: [
              { id: makeId('comp'), type: 'Heading', config: JSON.stringify({ text: '⚡ Lightning Fast Pipelines', level: 'h3', align: 'center', color: '#111827' }) },
              { id: makeId('comp'), type: 'Paragraph', config: JSON.stringify({ text: 'Move leads through stages instantly. Accelerate velocity with automated task generation.', align: 'center', color: '#4B5563' }) }
            ]
          },
          {
            id: makeId('col'),
            width: '1/3',
            settings: {},
            components: [
              { id: makeId('comp'), type: 'Heading', config: JSON.stringify({ text: '📅 Smart Scheduling', level: 'h3', align: 'center', color: '#111827' }) },
              { id: makeId('comp'), type: 'Paragraph', config: JSON.stringify({ text: 'Prevent double bookings. Integrate directly with representative availability calendars.', align: 'center', color: '#4B5563' }) }
            ]
          },
          {
            id: makeId('col'),
            width: '1/3',
            settings: {},
            components: [
              { id: makeId('comp'), type: 'Heading', config: JSON.stringify({ text: '🔒 Secure Data Sync', level: 'h3', align: 'center', color: '#111827' }) },
              { id: makeId('comp'), type: 'Paragraph', config: JSON.stringify({ text: 'Fully compliant backend storage and strict duplicate lead prevention checks.', align: 'center', color: '#4B5563' }) }
            ]
          }
        ]
      }];
    } else if (type === 'Benefits') {
      rows = [{
        id: makeId('row'),
        settings: {},
        columns: [
          {
            id: makeId('col'),
            width: '50/50',
            settings: {},
            components: [
              { id: makeId('comp'), type: 'Heading', config: JSON.stringify({ text: 'Why Choose GrowthOS?', level: 'h2', align: 'left', color: '#111827' }) },
              { id: makeId('comp'), type: 'Paragraph', config: JSON.stringify({ text: 'Our integrated workspace combines CRM lead tracking, automated visual funnel builders, reviews, and invoice payments under a single login. No more paying for five separate SaaS tools.', align: 'left', color: '#4B5563' }) }
            ]
          },
          {
            id: makeId('col'),
            width: '50/50',
            settings: {},
            components: [
              { id: makeId('comp'), type: 'Heading', config: JSON.stringify({ text: 'Built For Conversion', level: 'h3', align: 'left', color: '#4F46E5' }) },
              { id: makeId('comp'), type: 'Paragraph', config: JSON.stringify({ text: 'Every layout element is optimized to convert cold traffic into booked phone calls and paid invoices.', align: 'left', color: '#4B5563' }) }
            ]
          }
        ]
      }];
    } else if (type === 'Pricing') {
      rows = [{
        id: makeId('row'),
        settings: {},
        columns: [
          {
            id: makeId('col'),
            width: '1/3',
            settings: {},
            components: [
              { id: makeId('comp'), type: 'Heading', config: JSON.stringify({ text: 'Starter Plan', level: 'h3', align: 'center', color: '#1F2937' }) },
              { id: makeId('comp'), type: 'Paragraph', config: JSON.stringify({ text: '$29/month - Great for solo builders starting their visual pipeline journey.', align: 'center', color: '#4B5563' }) },
              { id: makeId('comp'), type: 'Button', config: JSON.stringify({ text: 'Buy Starter', size: 'small', alignment: 'center', style: 'outline', color: '#4F46E5', text_color: '#4F46E5', border_radius: '8px', full_width: true }) }
            ]
          },
          {
            id: makeId('col'),
            width: '1/3',
            settings: {},
            components: [
              { id: makeId('comp'), type: 'Heading', config: JSON.stringify({ text: 'Professional', level: 'h3', align: 'center', color: '#4F46E5' }) },
              { id: makeId('comp'), type: 'Paragraph', config: JSON.stringify({ text: '$79/month - Perfect for growing teams needing calendars and custom forms.', align: 'center', color: '#4B5563' }) },
              { id: makeId('comp'), type: 'Button', config: JSON.stringify({ text: 'Go Professional', size: 'medium', alignment: 'center', style: 'primary', color: '#4F46E5', text_color: '#FFFFFF', border_radius: '8px', full_width: true }) }
            ]
          },
          {
            id: makeId('col'),
            width: '1/3',
            settings: {},
            components: [
              { id: makeId('comp'), type: 'Heading', config: JSON.stringify({ text: 'Enterprise', level: 'h3', align: 'center', color: '#1F2937' }) },
              { id: makeId('comp'), type: 'Paragraph', config: JSON.stringify({ text: '$199/month - Unlimited pipelines, advanced automations, and dedicated support.', align: 'center', color: '#4B5563' }) },
              { id: makeId('comp'), type: 'Button', config: JSON.stringify({ text: 'Contact Sales', size: 'small', alignment: 'center', style: 'outline', color: '#1F2937', text_color: '#1F2937', border_radius: '8px', full_width: true }) }
            ]
          }
        ]
      }];
    } else if (type === '2-Column Section') {
      rows = [{
        id: makeId('row'),
        settings: {},
        columns: [
          { id: makeId('col'), width: '50/50', settings: {}, components: [] },
          { id: makeId('col'), width: '50/50', settings: {}, components: [] }
        ]
      }];
    } else if (type === '3-Column Section') {
      rows = [{
        id: makeId('row'),
        settings: {},
        columns: [
          { id: makeId('col'), width: '1/3', settings: {}, components: [] },
          { id: makeId('col'), width: '1/3', settings: {}, components: [] },
          { id: makeId('col'), width: '1/3', settings: {}, components: [] }
        ]
      }];
    } else {
      rows = [{
        id: makeId('row'),
        settings: {},
        columns: [{
          id: makeId('col'),
          width: '100%',
          settings: {},
          components: []
        }]
      }];
    }

    const newSec = {
      id: secId,
      name: `${type} Section`,
      type: type,
      settings: {
        padding: type === 'Navbar' ? "15px 20px" : type === 'Footer' ? "30px 20px" : "60px 0",
        margin: "0",
        background_color: bgCol,
        container_width: "container",
        visibility: "both",
        logo_text: '🚀 GrowthOS',
        logo_url: '',
        logo_align: 'left',
        sticky: false,
        transparent: false,
        shadow: 'light',
        show_divider: true,
        links: [
          { label: 'Features', url: '#features' },
          { label: 'Pricing', url: '#pricing' },
          { label: 'FAQ', url: '#faq' }
        ],
        cta_text: 'Try Free',
        cta_url: '#cta',
        cta_style: 'primary'
      },
      rows: rows
    };

    const nextLayout = { ...pageLayout, sections: [...(pageLayout.sections || []), newSec] };
    updateLayoutState(nextLayout);
  };

  const duplicateSection = (sIdx: number) => {
    const sec = pageLayout.sections[sIdx];
    const copy = JSON.parse(JSON.stringify(sec));
    copy.id = `sec_${Date.now()}`;
    const nextSections = [...pageLayout.sections];
    nextSections.splice(sIdx + 1, 0, copy);
    updateLayoutState({ ...pageLayout, sections: nextSections });
  };

  const deleteSection = (sIdx: number) => {
    const nextSections = pageLayout.sections.filter((_: any, i: number) => i !== sIdx);
    updateLayoutState({ ...pageLayout, sections: nextSections });
    setActiveElement({ type: 'page', id: 'page' });
  };

  const moveSection = (sIdx: number, dir: 'up' | 'down') => {
    const nextIdx = dir === 'up' ? sIdx - 1 : sIdx + 1;
    if (nextIdx < 0 || nextIdx >= pageLayout.sections.length) return;
    const nextSections = [...pageLayout.sections];
    const temp = nextSections[sIdx];
    nextSections[sIdx] = nextSections[nextIdx];
    nextSections[nextIdx] = temp;
    updateLayoutState({ ...pageLayout, sections: nextSections });
  };

  const reorderSections = (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0 || fromIdx >= pageLayout.sections.length || toIdx >= pageLayout.sections.length) return;
    const nextSections = [...pageLayout.sections];
    const [moved] = nextSections.splice(fromIdx, 1);
    nextSections.splice(toIdx, 0, moved);
    updateLayoutState({ ...pageLayout, sections: nextSections });
    showToast('Section reordered successfully!');
  };

  const moveComponent = (
    fromSIdx: number, fromRIdx: number, fromCIdx: number, fromCompIdx: number,
    toSIdx: number, toRIdx: number, toCIdx: number, toCompIdx: number
  ) => {
    if (!pageLayout) return;
    const nextLayout = JSON.parse(JSON.stringify(pageLayout));
    const sourceCol = nextLayout.sections[fromSIdx]?.rows[fromRIdx]?.columns[fromCIdx];
    const destCol = nextLayout.sections[toSIdx]?.rows[toRIdx]?.columns[toCIdx];
    if (!sourceCol || !destCol) return;
    const [movedComp] = sourceCol.components.splice(fromCompIdx, 1);
    if (!movedComp) return;
    destCol.components.splice(toCompIdx, 0, movedComp);
    updateLayoutState(nextLayout);
    showToast('Component moved successfully!');
  };

  const addRow = (sIdx: number, widthPattern: string = '100%') => {
    let columns = [];
    if (widthPattern === '100%') {
      columns = [{ id: `col_${Date.now()}_1`, width: '100%', settings: {}, components: [] }];
    } else if (widthPattern === '50/50') {
      columns = [
        { id: `col_${Date.now()}_1`, width: '50/50', settings: {}, components: [] },
        { id: `col_${Date.now()}_2`, width: '50/50', settings: {}, components: [] }
      ];
    } else if (widthPattern === '33/33/33') {
      columns = [
        { id: `col_${Date.now()}_1`, width: '1/3', settings: {}, components: [] },
        { id: `col_${Date.now()}_2`, width: '1/3', settings: {}, components: [] },
        { id: `col_${Date.now()}_3`, width: '1/3', settings: {}, components: [] }
      ];
    } else if (widthPattern === '25/75') {
      columns = [
        { id: `col_${Date.now()}_1`, width: '25/75', settings: {}, components: [] },
        { id: `col_${Date.now()}_2`, width: '25/75', settings: {}, components: [] }
      ];
    } else if (widthPattern === '75/25') {
      columns = [
        { id: `col_${Date.now()}_1`, width: '75/25', settings: {}, components: [] },
        { id: `col_${Date.now()}_2`, width: '75/25', settings: {}, components: [] }
      ];
    } else {
      columns = [{ id: `col_${Date.now()}_1`, width: '100%', settings: {}, components: [] }];
    }

    const newRow = {
      id: `row_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      settings: {},
      columns
    };

    const nextSections = [...pageLayout.sections];
    nextSections[sIdx] = {
      ...nextSections[sIdx],
      rows: [...(nextSections[sIdx].rows || []), newRow]
    };
    updateLayoutState({ ...pageLayout, sections: nextSections });
  };

  const rebalanceRowColumnWidths = (row: any) => {
    if (!row || !row.columns) return;
    const count = row.columns.length;
    if (count === 1) {
      row.columns[0].width = '100%';
    } else if (count === 2) {
      row.columns.forEach((c: any) => c.width = '1/2');
    } else if (count === 3) {
      row.columns.forEach((c: any) => c.width = '1/3');
    } else if (count >= 4) {
      row.columns.forEach((c: any) => c.width = '1/4');
    }
  };

  const deleteRow = (sIdx: number, rIdx: number) => {
    const nextSections = [...pageLayout.sections];
    nextSections[sIdx].rows = nextSections[sIdx].rows.filter((_: any, i: number) => i !== rIdx);
    updateLayoutState({ ...pageLayout, sections: nextSections });
    setActiveElement({ type: 'page', id: 'page' });
  };

  const addColumnToRow = (sIdx: number, rIdx: number, widthRatio: string = '1/3') => {
    const nextSections = [...pageLayout.sections];
    let targetRow = nextSections[sIdx].rows[rIdx];
    let targetRIdx = rIdx;

    if (!targetRow) return;
    targetRow.columns = targetRow.columns || [];

    // If target row already has 4 or more columns, find or create next row below
    if (targetRow.columns.length >= 4) {
      const nextRowIdx = rIdx + 1;
      const nextRow = nextSections[sIdx].rows[nextRowIdx];
      if (nextRow && (nextRow.columns || []).length < 4) {
        targetRow = nextRow;
        targetRIdx = nextRowIdx;
      } else {
        const newColId = `col_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const newRow = {
          id: `row_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          settings: {},
          columns: [{ id: newColId, width: '1/3', settings: {}, components: [] }]
        };
        nextSections[sIdx].rows.splice(rIdx + 1, 0, newRow);
        rebalanceRowColumnWidths(newRow);
        updateLayoutState({ ...pageLayout, sections: nextSections });
        setActiveElement({ type: 'column', id: newColId, sectionIndex: sIdx, rowIndex: rIdx + 1, columnIndex: 0 });
        showToast('Added column into new row below to maintain 4-col max width!');
        return;
      }
    }

    const newColId = `col_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    targetRow.columns.push({
      id: newColId,
      width: widthRatio,
      settings: {},
      components: []
    });

    rebalanceRowColumnWidths(targetRow);

    updateLayoutState({ ...pageLayout, sections: nextSections });
    setActiveElement({ type: 'column', id: newColId, sectionIndex: sIdx, rowIndex: targetRIdx, columnIndex: targetRow.columns.length - 1 });
  };

  const duplicateColumn = (sIdx: number, rIdx: number, cIdx: number) => {
    const nextSections = [...pageLayout.sections];
    let targetRow = nextSections[sIdx].rows[rIdx];
    let targetRIdx = rIdx;

    if (!targetRow || !targetRow.columns) return;
    const col = targetRow.columns[cIdx];
    if (!col) return;

    const colCopy = JSON.parse(JSON.stringify(col));
    colCopy.id = `col_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    if (colCopy.components) {
      colCopy.components.forEach((comp: any) => {
        comp.id = `comp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      });
    }

    if (targetRow.columns.length >= 4) {
      const nextRowIdx = rIdx + 1;
      const nextRow = nextSections[sIdx].rows[nextRowIdx];
      if (nextRow && (nextRow.columns || []).length < 4) {
        nextRow.columns.push(colCopy);
        rebalanceRowColumnWidths(nextRow);
        updateLayoutState({ ...pageLayout, sections: nextSections });
        setActiveElement({ type: 'column', id: colCopy.id, sectionIndex: sIdx, rowIndex: nextRowIdx, columnIndex: nextRow.columns.length - 1 });
      } else {
        const newRow = {
          id: `row_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          settings: {},
          columns: [colCopy]
        };
        rebalanceRowColumnWidths(newRow);
        nextSections[sIdx].rows.splice(rIdx + 1, 0, newRow);
        updateLayoutState({ ...pageLayout, sections: nextSections });
        setActiveElement({ type: 'column', id: colCopy.id, sectionIndex: sIdx, rowIndex: rIdx + 1, columnIndex: 0 });
      }
      showToast('Duplicated column into row below!');
      return;
    }

    targetRow.columns.splice(cIdx + 1, 0, colCopy);
    rebalanceRowColumnWidths(targetRow);

    updateLayoutState({ ...pageLayout, sections: nextSections });
    setActiveElement({ type: 'column', id: colCopy.id, sectionIndex: sIdx, rowIndex: targetRIdx, columnIndex: cIdx + 1 });
  };

  const deleteColumn = (sIdx: number, rIdx: number, cIdx: number) => {
    const nextSections = [...pageLayout.sections];
    const row = nextSections[sIdx].rows[rIdx];
    if (row && row.columns && row.columns.length > 1) {
      row.columns.splice(cIdx, 1);
      rebalanceRowColumnWidths(row);
      updateLayoutState({ ...pageLayout, sections: nextSections });
      setActiveElement({ type: 'row', id: row.id, sectionIndex: sIdx, rowIndex: rIdx });
    } else if (row && row.columns && row.columns.length === 1 && nextSections[sIdx].rows.length > 1) {
      deleteRow(sIdx, rIdx);
    }
  };

  const setRowLayoutPreset = (sIdx: number, rIdx: number, preset: string) => {
    const nextSections = [...pageLayout.sections];
    const row = nextSections[sIdx].rows[rIdx];
    row.columns = row.columns || [];

    if (preset === '100%') {
      row.columns = [row.columns[0] || { id: `col_${Date.now()}`, width: '100%', settings: {}, components: [] }];
      row.columns[0].width = '100%';
    } else if (preset === '50/50') {
      while (row.columns.length < 2) {
        row.columns.push({ id: `col_${Date.now()}_${row.columns.length}`, width: '1/2', settings: {}, components: [] });
      }
      if (row.columns.length > 2) row.columns = row.columns.slice(0, 2);
      row.columns.forEach((c: any) => c.width = '1/2');
    } else if (preset === '33/33/33') {
      while (row.columns.length < 3) {
        row.columns.push({ id: `col_${Date.now()}_${row.columns.length}`, width: '1/3', settings: {}, components: [] });
      }
      if (row.columns.length > 3) row.columns = row.columns.slice(0, 3);
      row.columns.forEach((c: any) => c.width = '1/3');
    } else if (preset === '25/25/25/25') {
      while (row.columns.length < 4) {
        row.columns.push({ id: `col_${Date.now()}_${row.columns.length}`, width: '1/4', settings: {}, components: [] });
      }
      if (row.columns.length > 4) row.columns = row.columns.slice(0, 4);
      row.columns.forEach((c: any) => c.width = '1/4');
    } else if (preset === '20/20/20/20/20') {
      while (row.columns.length < 5) {
        row.columns.push({ id: `col_${Date.now()}_${row.columns.length}`, width: '1/5', settings: {}, components: [] });
      }
      if (row.columns.length > 5) row.columns = row.columns.slice(0, 5);
      row.columns.forEach((c: any) => c.width = '1/5');
    }

    updateLayoutState({ ...pageLayout, sections: nextSections });
  };

  const addComponentToColumn = (sIdx: number, rIdx: number, cIdx: number, type: string) => {
    setRecentlyUsedComponents(prev => {
      const filtered = prev.filter(c => c !== type);
      return [type, ...filtered].slice(0, 5);
    });

    let defaultConfig = {};
    switch (type) {
      case 'Heading':
        defaultConfig = { text: 'Heading Text', level: 'h1', font_size: '48px', font_weight: '700', color: '#111827', align: 'left', margin: '0 0 16px 0' };
        break;
      case 'Paragraph':
        defaultConfig = { text: 'Enter your paragraph description here...', font_size: '18px', line_height: '1.7', color: '#4b5563', align: 'left', margin: '0 0 20px 0', max_width: '700px' };
        break;
      case 'Button':
        defaultConfig = { text: 'Call to Action →', action_type: 'go_to_next_step', action_value: '', color: '#4F46E5', text_color: '#FFFFFF', style: 'primary', size: 'medium', border_radius: '8px', padding: '12px 24px', width: 'auto' };
        break;
      case 'Image':
        defaultConfig = { url: '', alt: 'Image description', width: '100%', height: 'auto', border_radius: '8px', alignment: 'center', object_fit: 'contain', loading: 'lazy' };
        break;
      case 'Video':
        defaultConfig = { url: '', provider: 'youtube', autoplay: false, controls: true, loop: false, mute: false, poster: '' };
        break;
      case 'Form':
        defaultConfig = { form_id: forms[0]?.id || '' };
        break;
      case 'Countdown':
        defaultConfig = { target_date: '2026-12-31T23:59', expired_message: 'Offer Expired!', format: 'days_hours_minutes_seconds' };
        break;
      case 'Spacer':
        defaultConfig = { height: '24px' };
        break;
      case 'Divider':
        defaultConfig = { color: '#e5e7eb', thickness: '1px', margin: '20px 0' };
        break;
      case 'Calendar':
        defaultConfig = { title: 'Book a Call', month: 'October', day: '15', time: '10:00 AM' };
        break;
      case 'Icons':
        defaultConfig = { icon_name: 'Check', size: 24, color: '#4F46E5', alignment: 'center' };
        break;
      case 'SocialLinks':
        defaultConfig = { facebook: '', twitter: '', linkedin: '', instagram: '', youtube: '', align: 'center' };
        break;
      case 'FAQ':
        defaultConfig = { items: [{ question: 'What is the refund policy?', answer: 'We offer a 30-day money-back guarantee.' }] };
        break;
      case 'Testimonials':
        defaultConfig = { items: [{ quote: 'This service is outstanding!', author: 'Jane Doe', role: 'CEO', avatar_url: '' }] };
        break;
      case 'Columns':
        defaultConfig = { layout: '50/50', col_1_components: [], col_2_components: [] };
        break;
      case 'CustomHTML':
        defaultConfig = { code: '<div style="padding: 20px; text-align: center;">Custom HTML Content</div>' };
        break;
    }

    const newComp = {
      id: `comp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      type,
      config: JSON.stringify(defaultConfig)
    };

    const nextSections = [...pageLayout.sections];
    nextSections[sIdx].rows[rIdx].columns[cIdx].components.push(newComp);
    updateLayoutState({ ...pageLayout, sections: nextSections });
    setActiveElement({ type: 'component', id: newComp.id, sectionIndex: sIdx, rowIndex: rIdx, columnIndex: cIdx, index: nextSections[sIdx].rows[rIdx].columns[cIdx].components.length - 1 });
  };

  const deleteComponent = (sIdx: number, rIdx: number, cIdx: number, compIdx: number) => {
    const nextSections = [...pageLayout.sections];
    nextSections[sIdx].rows[rIdx].columns[cIdx].components = nextSections[sIdx].rows[rIdx].columns[cIdx].components.filter((_: any, i: number) => i !== compIdx);
    updateLayoutState({ ...pageLayout, sections: nextSections });
    setActiveElement({ type: 'page', id: 'page' });
  };

  const duplicateComponent = (sIdx: number, rIdx: number, cIdx: number, compIdx: number) => {
    const nextSections = [...pageLayout.sections];
    const comp = nextSections[sIdx].rows[rIdx].columns[cIdx].components[compIdx];
    const copy = JSON.parse(JSON.stringify(comp));
    copy.id = `comp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    nextSections[sIdx].rows[rIdx].columns[cIdx].components.splice(compIdx + 1, 0, copy);
    updateLayoutState({ ...pageLayout, sections: nextSections });
    setActiveElement({ type: 'component', id: copy.id, sectionIndex: sIdx, rowIndex: rIdx, columnIndex: cIdx, index: compIdx + 1 });
  };

  // Wire keyboard handlers ref so the early-registered useEffect can call them
  // (avoids TS2448/2454 block-scope TDZ errors)
  useEffect(() => {
    keyboardHandlersRef.current = {
      deleteComponent,
      deleteRow,
      deleteSection,
      duplicateComponent,
      duplicateSection,
    };
  });

  const handleUpdateActiveProperties = (updates: { [key: string]: any }, skipHistory = false) => {
    if (!activeElement || !pageLayout) return;
    const nextLayout = JSON.parse(JSON.stringify(pageLayout));

    if (activeElement.type === 'page') {
      for (const [key, value] of Object.entries(updates)) {
        nextLayout[key] = value;
      }
    } else if (activeElement.type === 'section') {
      const sec = nextLayout.sections[activeElement.sectionIndex!];
      for (const [key, value] of Object.entries(updates)) {
        sec[key] = value;
      }
    } else if (activeElement.type === 'row') {
      const row = nextLayout.sections[activeElement.sectionIndex!].rows[activeElement.rowIndex!];
      row.settings = row.settings || {};
      for (const [key, value] of Object.entries(updates)) {
        row.settings[key] = value;
      }
    } else if (activeElement.type === 'column') {
      const col = nextLayout.sections[activeElement.sectionIndex!].rows[activeElement.rowIndex!].columns[activeElement.columnIndex!];
      col.settings = col.settings || {};
      for (const [key, value] of Object.entries(updates)) {
        col.settings[key] = value;
      }
    } else if (activeElement.type === 'component') {
      const comp = nextLayout.sections[activeElement.sectionIndex!].rows[activeElement.rowIndex!].columns[activeElement.columnIndex!].components[activeElement.index!];
      let parsed: any = {};
      try {
        parsed = typeof comp.config === 'string' ? JSON.parse(comp.config || '{}') : (comp.config || {});
      } catch { }
      for (const [key, value] of Object.entries(updates)) {
        parsed[key] = value;
      }
      comp.config = JSON.stringify(parsed);
    }
    updateLayoutState(nextLayout, skipHistory);
  };

  const handleUpdateActiveProperty = (key: string, value: any, subkey?: string, skipHistory = false) => {
    if (!activeElement || !pageLayout) return;
    if (subkey) {
      const nextLayout = JSON.parse(JSON.stringify(pageLayout));
      if (activeElement.type === 'page') {
        nextLayout[key] = nextLayout[key] || {};
        nextLayout[key][subkey] = value;
      } else if (activeElement.type === 'section') {
        const sec = nextLayout.sections[activeElement.sectionIndex!];
        sec[key] = sec[key] || {};
        sec[key][subkey] = value;
      } else if (activeElement.type === 'row') {
        const row = nextLayout.sections[activeElement.sectionIndex!].rows[activeElement.rowIndex!];
        row[key] = row[key] || {};
        row[key][subkey] = value;
      } else if (activeElement.type === 'column') {
        const col = nextLayout.sections[activeElement.sectionIndex!].rows[activeElement.rowIndex!].columns[activeElement.columnIndex!];
        col[key] = col[key] || {};
        col[key][subkey] = value;
      } else if (activeElement.type === 'component') {
        const comp = nextLayout.sections[activeElement.sectionIndex!].rows[activeElement.rowIndex!].columns[activeElement.columnIndex!].components[activeElement.index!];
        if (key === 'config') {
          let parsed: any = {};
          try {
            parsed = typeof comp.config === 'string' ? JSON.parse(comp.config || '{}') : (comp.config || {});
          } catch { }
          parsed[subkey] = value;
          comp.config = JSON.stringify(parsed);
        } else {
          comp[key] = comp[key] || {};
          comp[key][subkey] = value;
        }
      }
      updateLayoutState(nextLayout, skipHistory);
    } else {
      handleUpdateActiveProperties({ [key]: value }, skipHistory);
    }
  };

  const renderInspectorAccordionSection = (
    sectionKey: string,
    title: string,
    content: React.ReactNode
  ) => {
    const isOpen = !!openInspectorGroups[sectionKey];
    return (
      <div key={sectionKey} style={{ borderBottom: '1px solid #e2e8f0' }}>
        <div
          className={styles.settingsSectionHeader}
          onClick={() => setOpenInspectorGroups(prev => ({ ...prev, [sectionKey]: !prev[sectionKey] }))}
        >
          <span>{title}</span>
          <span>{isOpen ? '▼' : '▶'}</span>
        </div>
        {isOpen && (
          <div className={styles.settingsSectionContent}>
            {content}
          </div>
        )}
      </div>
    );
  };

  const handleUpdateLayoutSetting = (group: 'margin' | 'padding' | 'width' | 'height' | 'minWidth' | 'maxWidth' | 'minHeight' | 'maxHeight', device: 'desktop' | 'tablet' | 'mobile', sideOrVal: string | undefined, newVal: any) => {
    if (!activeElement || !pageLayout) return;
    const nextLayout = JSON.parse(JSON.stringify(pageLayout));
    let elementSettingsContainer: any = null;
    let isComp = false;
    let compRef: any = null;

    if (activeElement.type === 'page') {
      nextLayout.globalSettings = nextLayout.globalSettings || {};
      elementSettingsContainer = nextLayout.globalSettings;
    } else if (activeElement.type === 'section') {
      const sec = nextLayout.sections[activeElement.sectionIndex!];
      sec.settings = sec.settings || {};
      elementSettingsContainer = sec.settings;
    } else if (activeElement.type === 'row') {
      const row = nextLayout.sections[activeElement.sectionIndex!].rows[activeElement.rowIndex!];
      row.settings = row.settings || {};
      elementSettingsContainer = row.settings;
    } else if (activeElement.type === 'column') {
      const col = nextLayout.sections[activeElement.sectionIndex!].rows[activeElement.rowIndex!].columns[activeElement.columnIndex!];
      col.settings = col.settings || {};
      elementSettingsContainer = col.settings;
    } else if (activeElement.type === 'component') {
      const comp = nextLayout.sections[activeElement.sectionIndex!].rows[activeElement.rowIndex!].columns[activeElement.columnIndex!].components[activeElement.index!];
      isComp = true;
      compRef = comp;
      try {
        elementSettingsContainer = typeof comp.config === 'string' ? JSON.parse(comp.config || '{}') : (comp.config || {});
      } catch {
        elementSettingsContainer = {};
      }
    }

    elementSettingsContainer.layoutSettings = elementSettingsContainer.layoutSettings || {};
    const ls = elementSettingsContainer.layoutSettings;

    if (sideOrVal) {
      ls[group] = ls[group] || {};
      ls[group][device] = ls[group][device] || {};
      ls[group][device][sideOrVal] = newVal;
    } else {
      ls[group] = ls[group] || {};
      ls[group][device] = newVal;
    }

    if (isComp && compRef) {
      compRef.config = JSON.stringify(elementSettingsContainer);
    }
    updateLayoutState(nextLayout, true);
  };

  const renderUniversalLayoutInspector = () => {
    if (!activeElement || !pageLayout) return null;

    let cfg: any = {};
    let isPage = activeElement.type === 'page';
    let isSec = activeElement.type === 'section';
    let isRow = activeElement.type === 'row';
    let isCol = activeElement.type === 'column';
    let isComp = activeElement.type === 'component';

    if (isPage) {
      cfg = pageLayout.globalSettings || {};
    } else if (isSec) {
      const sec = pageLayout.sections[activeElement.sectionIndex!];
      cfg = sec?.settings || {};
    } else if (isRow) {
      const row = pageLayout.sections[activeElement.sectionIndex!].rows[activeElement.rowIndex!];
      cfg = row?.settings || {};
    } else if (isCol) {
      const col = pageLayout.sections[activeElement.sectionIndex!].rows[activeElement.rowIndex!].columns[activeElement.columnIndex!];
      cfg = col?.settings || {};
    } else if (isComp) {
      const comp = pageLayout.sections[activeElement.sectionIndex!].rows[activeElement.rowIndex!].columns[activeElement.columnIndex!].components[activeElement.index!];
      try {
        cfg = typeof comp.config === 'string' ? JSON.parse(comp.config || '{}') : (comp.config || {});
      } catch {
        cfg = {};
      }
    }

    const ls = cfg.layoutSettings || {};
    const margin = ls.margin || {};
    const padding = ls.padding || {};

    const view = activeViewMode === 'mobile' ? 'mobile' : activeViewMode === 'tablet' ? 'tablet' : 'desktop';

    const getMarginVal = (side: string) => margin[view]?.[side] ?? '';
    const getPaddingVal = (side: string) => padding[view]?.[side] ?? '';

    const handleMarginChange = (side: string, val: any) => {
      handleUpdateLayoutSetting('margin', view, side, val);
    };

    const handlePaddingChange = (side: string, val: any) => {
      handleUpdateLayoutSetting('padding', view, side, val);
    };

    const getDimensionVal = (dim: any) => ls[dim]?.[view] ?? '';
    const handleDimensionChange = (dim: any, val: any) => {
      handleUpdateLayoutSetting(dim, view, undefined, val);
    };

    const updateStyleProp = (key: string, val: any) => {
      if (isComp) {
        handleUpdateActiveProperty(key, val, undefined, true);
      } else {
        handleUpdateActiveProperty('settings', val, key, true);
      }
      commitToHistory();
    };

    return (
      <>

        {renderInspectorAccordionSection('layout_spacing', 'Spacing (' + view.toUpperCase() + ')', (
          <>
            <div style={{ fontWeight: 700, fontSize: '11px', color: '#64748B', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Margin</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <NumericSliderInput label="Top" value={getMarginVal('top')} onChange={val => handleMarginChange('top', val)} min={0} max={150} allowedUnits={['px', '%', 'em', 'rem', 'auto']} onBlur={commitToHistory} />
              <NumericSliderInput label="Bottom" value={getMarginVal('bottom')} onChange={val => handleMarginChange('bottom', val)} min={0} max={150} allowedUnits={['px', '%', 'em', 'rem', 'auto']} onBlur={commitToHistory} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
              <NumericSliderInput label="Left" value={getMarginVal('left')} onChange={val => handleMarginChange('left', val)} min={0} max={150} allowedUnits={['px', '%', 'em', 'rem', 'auto']} onBlur={commitToHistory} />
              <NumericSliderInput label="Right" value={getMarginVal('right')} onChange={val => handleMarginChange('right', val)} min={0} max={150} allowedUnits={['px', '%', 'em', 'rem', 'auto']} onBlur={commitToHistory} />
            </div>

            <div style={{ fontWeight: 700, fontSize: '11px', color: '#64748B', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Padding</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <NumericSliderInput label="Top" value={getPaddingVal('top')} onChange={val => handlePaddingChange('top', val)} min={0} max={150} allowedUnits={['px', '%', 'em', 'rem', 'auto']} onBlur={commitToHistory} />
              <NumericSliderInput label="Bottom" value={getPaddingVal('bottom')} onChange={val => handlePaddingChange('bottom', val)} min={0} max={150} allowedUnits={['px', '%', 'em', 'rem', 'auto']} onBlur={commitToHistory} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <NumericSliderInput label="Left" value={getPaddingVal('left')} onChange={val => handlePaddingChange('left', val)} min={0} max={150} allowedUnits={['px', '%', 'em', 'rem', 'auto']} onBlur={commitToHistory} />
              <NumericSliderInput label="Right" value={getPaddingVal('right')} onChange={val => handlePaddingChange('right', val)} min={0} max={150} allowedUnits={['px', '%', 'em', 'rem', 'auto']} onBlur={commitToHistory} />
            </div>
          </>
        ))}

        {renderInspectorAccordionSection('layout_borders', 'Borders', (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
              <div className={styles.fieldGroup}>
                <label>Border Style</label>
                <select value={cfg.border_style || ''} onChange={e => updateStyleProp('border_style', e.target.value)}>
                  <option value="">None</option>
                  <option value="solid">Solid</option>
                  <option value="dashed">Dashed</option>
                  <option value="dotted">Dotted</option>
                </select>
              </div>
              {renderColorPickerField('Border Color', cfg.border_color, '#e2e8f0', (val) => updateStyleProp('border_color', val))}
            </div>
            <NumericSliderInput
              label="Border Width"
              value={cfg.border_width}
              onChange={val => updateStyleProp('border_width', val)}
              min={0}
              max={20}
              allowedUnits={['px', 'em']}
              onBlur={commitToHistory}
            />
            <NumericSliderInput
              label="Corner Radius"
              value={cfg.border_radius}
              onChange={val => updateStyleProp('border_radius', val)}
              min={0}
              max={100}
              allowedUnits={['px', '%', 'em']}
              onBlur={commitToHistory}
            />
          </>
        ))}

        {renderInspectorAccordionSection('layout_effects', 'Effects', (
          <>
            {renderColorPickerField('Background Color', cfg.background_color, '#ffffff', (val) => updateStyleProp('background_color', val))}
            <NumericSliderInput
              label="Opacity"
              value={cfg.opacity !== undefined ? cfg.opacity : 1}
              onChange={val => updateStyleProp('opacity', val)}
              min={0}
              max={1}
              step={0.1}
              onBlur={commitToHistory}
            />
          </>
        ))}
      </>
    );
  };

  const renderComponentSettings = (comp: any, parsedConfig: any) => {
    const renderGlobalLayoutFields = () => (
      <>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
          <div className={styles.fieldGroup}>
            <label>Padding (Desktop)</label>
            <input placeholder="e.g. 10px 20px" value={parsedConfig.padding || ''} onChange={e => handleUpdateActiveProperty('padding', e.target.value, undefined, true)} onBlur={commitToHistory} />
          </div>
          <div className={styles.fieldGroup}>
            <label>Padding (Mobile)</label>
            <input placeholder="e.g. 5px 10px" value={parsedConfig.padding_mobile || ''} onChange={e => handleUpdateActiveProperty('padding_mobile', e.target.value, undefined, true)} onBlur={commitToHistory} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
          <div className={styles.fieldGroup}>
            <label>Margin (Desktop)</label>
            <input placeholder="e.g. 0 0 16px 0" value={parsedConfig.margin || ''} onChange={e => handleUpdateActiveProperty('margin', e.target.value, undefined, true)} onBlur={commitToHistory} />
          </div>
          <div className={styles.fieldGroup}>
            <label>Margin (Mobile)</label>
            <input placeholder="e.g. 0 0 8px 0" value={parsedConfig.margin_mobile || ''} onChange={e => handleUpdateActiveProperty('margin_mobile', e.target.value, undefined, true)} onBlur={commitToHistory} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
          <div className={styles.fieldGroup}>
            <label>Width</label>
            <input placeholder="e.g. 100% or auto" value={parsedConfig.width || ''} onChange={e => handleUpdateActiveProperty('width', e.target.value, undefined, true)} onBlur={commitToHistory} />
          </div>
          <div className={styles.fieldGroup}>
            <label>Max Width</label>
            <input placeholder="e.g. 700px" value={parsedConfig.max_width || ''} onChange={e => handleUpdateActiveProperty('max_width', e.target.value, undefined, true)} onBlur={commitToHistory} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
          <div className={styles.fieldGroup}>
            <label>Height</label>
            <input placeholder="e.g. auto or 200px" value={parsedConfig.height || ''} onChange={e => handleUpdateActiveProperty('height', e.target.value, undefined, true)} onBlur={commitToHistory} />
          </div>
          <div className={styles.fieldGroup}>
            <label>Overflow</label>
            <select value={parsedConfig.overflow || ''} onChange={e => handleUpdateActiveProperty('overflow', e.target.value)}>
              <option value="">Default</option>
              <option value="visible">Visible</option>
              <option value="hidden">Hidden</option>
              <option value="scroll">Scroll</option>
              <option value="auto">Auto</option>
            </select>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
          <div className={styles.fieldGroup}>
            <label>Align Self (Flex)</label>
            <select value={parsedConfig.align_self || ''} onChange={e => handleUpdateActiveProperty('align_self', e.target.value)}>
              <option value="">Default</option>
              <option value="flex-start">Start</option>
              <option value="center">Center</option>
              <option value="flex-end">End</option>
              <option value="stretch">Stretch</option>
            </select>
          </div>
          <div className={styles.fieldGroup}>
            <label>Display Mode</label>
            <select value={parsedConfig.display || ''} onChange={e => handleUpdateActiveProperty('display', e.target.value)}>
              <option value="">Default</option>
              <option value="block">Block</option>
              <option value="inline-block">Inline Block</option>
              <option value="flex">Flex</option>
              <option value="none">Hidden</option>
            </select>
          </div>
        </div>
      </>
    );

    const renderGlobalStyleFields = () => (
      <>
        {renderColorPickerField('Background Color', parsedConfig.background_color, '#ffffff', (val) => handleUpdateActiveProperty('background_color', val))}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
          <div className={styles.fieldGroup}>
            <label>Border Style</label>
            <select value={parsedConfig.border_style || ''} onChange={e => handleUpdateActiveProperty('border_style', e.target.value)}>
              <option value="">None</option>
              <option value="solid">Solid</option>
              <option value="dashed">Dashed</option>
              <option value="dotted">Dotted</option>
            </select>
          </div>
          <div className={styles.fieldGroup}>
            <label>Border Width</label>
            <input placeholder="e.g. 1px" value={parsedConfig.border_width || ''} onChange={e => handleUpdateActiveProperty('border_width', e.target.value, undefined, true)} onBlur={commitToHistory} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
          {renderColorPickerField('Border Color', parsedConfig.border_color, '#e2e8f0', (val) => handleUpdateActiveProperty('border_color', val))}
          <div className={styles.fieldGroup}>
            <label>Corner Radius</label>
            <input placeholder="e.g. 8px" value={parsedConfig.border_radius || ''} onChange={e => handleUpdateActiveProperty('border_radius', e.target.value, undefined, true)} onBlur={commitToHistory} />
          </div>
        </div>
        <div className={styles.fieldGroup} style={{ marginBottom: '8px' }}>
          <label>Box Shadow</label>
          <input placeholder="e.g. 0 4px 6px rgba(0,0,0,0.05)" value={parsedConfig.box_shadow || ''} onChange={e => handleUpdateActiveProperty('box_shadow', e.target.value, undefined, true)} onBlur={commitToHistory} />
        </div>
        <div className={styles.fieldGroup} style={{ marginBottom: '8px' }}>
          <label>Opacity (0.0 to 1.0)</label>
          <input type="number" step="0.1" min="0" max="1" value={parsedConfig.opacity !== undefined ? parsedConfig.opacity : 1} onChange={e => handleUpdateActiveProperty('opacity', Number(e.target.value))} />
        </div>
      </>
    );

    const renderGlobalTypographyFields = () => (
      <>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
          <div className={styles.fieldGroup}>
            <label>Font Size (Desktop)</label>
            <input placeholder="e.g. 18px" value={parsedConfig.font_size || ''} onChange={e => handleUpdateActiveProperty('font_size', e.target.value, undefined, true)} onBlur={commitToHistory} />
          </div>
          <div className={styles.fieldGroup}>
            <label>Font Size (Mobile)</label>
            <input placeholder="e.g. 16px" value={parsedConfig.font_size_mobile || ''} onChange={e => handleUpdateActiveProperty('font_size_mobile', e.target.value, undefined, true)} onBlur={commitToHistory} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
          <div className={styles.fieldGroup}>
            <label>Font Weight</label>
            <select value={parsedConfig.font_weight || ''} onChange={e => handleUpdateActiveProperty('font_weight', e.target.value)}>
              <option value="">Default</option>
              <option value="300">Light (300)</option>
              <option value="400">Regular (400)</option>
              <option value="600">Semi-Bold (600)</option>
              <option value="700">Bold (700)</option>
              <option value="800">Extra-Bold (800)</option>
            </select>
          </div>
          <div className={styles.fieldGroup}>
            <label>Line Height</label>
            <input placeholder="e.g. 1.6" value={parsedConfig.line_height || ''} onChange={e => handleUpdateActiveProperty('line_height', e.target.value, undefined, true)} onBlur={commitToHistory} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
          <div className={styles.fieldGroup}>
            <label>Letter Spacing</label>
            <input placeholder="e.g. -0.5px" value={parsedConfig.letter_spacing || ''} onChange={e => handleUpdateActiveProperty('letter_spacing', e.target.value, undefined, true)} onBlur={commitToHistory} />
          </div>
          <div className={styles.fieldGroup}>
            <label>Text Case</label>
            <select value={parsedConfig.text_transform || ''} onChange={e => handleUpdateActiveProperty('text_transform', e.target.value)}>
              <option value="">Default</option>
              <option value="uppercase">UPPERCASE</option>
              <option value="lowercase">lowercase</option>
              <option value="capitalize">Capitalize</option>
            </select>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
          <div className={styles.fieldGroup}>
            <label>Text Align (Desktop)</label>
            <select value={parsedConfig.alignment || parsedConfig.align || 'left'} onChange={e => handleUpdateActiveProperty('alignment', e.target.value)}>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
              <option value="justify">Justify</option>
            </select>
          </div>
          <div className={styles.fieldGroup}>
            <label>Text Align (Mobile)</label>
            <select value={parsedConfig.alignment_mobile || parsedConfig.align_mobile || ''} onChange={e => handleUpdateActiveProperty('alignment_mobile', e.target.value)}>
              <option value="">Default</option>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
              <option value="justify">Justify</option>
            </select>
          </div>
        </div>
      </>
    );

    const renderGlobalAdvancedFields = () => (
      <>
        <div className={styles.fieldGroup} style={{ marginBottom: '8px' }}>
          <label>Device Visibility</label>
          <select value={parsedConfig.visibility || 'both'} onChange={e => handleUpdateActiveProperty('visibility', e.target.value)}>
            <option value="both">Desktop, Tablet & Mobile</option>
            <option value="desktop_only">Desktop Only</option>
            <option value="mobile_only">Mobile Only</option>
            <option value="hidden">Hidden</option>
          </select>
        </div>
        <div className={styles.fieldGroup} style={{ marginBottom: '8px' }}>
          <label>Custom CSS (Scopes to .comp-XYZ)</label>
          <textarea placeholder="/* Scoped CSS styling */" rows={4} value={parsedConfig.custom_css || ''} onChange={e => handleUpdateActiveProperty('custom_css', e.target.value, undefined, true)} onBlur={commitToHistory} style={{ fontFamily: 'monospace', fontSize: '11px' }} />
        </div>
      </>
    );
    let layoutFields: React.ReactNode = null;
    let styleFields: React.ReactNode = null;
    let typographyFields: React.ReactNode = null;
    let advancedFields: React.ReactNode = null;

    if (comp.type === 'Heading') {
      typographyFields = (
        <>
          <div className={styles.fieldGroup}>
            <label>Heading Text</label>
            <input value={parsedConfig.text || ''} onChange={e => handleUpdateActiveProperty('text', e.target.value, undefined, true)} onBlur={commitToHistory} />
          </div>
          <div className={styles.fieldGroup}>
            <label>Heading HTML Level</label>
            <select value={parsedConfig.level || 'h2'} onChange={e => handleUpdateActiveProperty('level', e.target.value)}>
              <option value="h1">Header 1 (h1)</option>
              <option value="h2">Header 2 (h2)</option>
              <option value="h3">Header 3 (h3)</option>
              <option value="h4">Header 4 (h4)</option>
            </select>
          </div>
          {renderColorPickerField('Text Custom Color', parsedConfig.color, '#111827', (val) => handleUpdateActiveProperty('color', val), 'inherit')}
          <div className={styles.fieldGroup}>
            <label>Alignment</label>
            <select value={parsedConfig.align || 'left'} onChange={e => handleUpdateActiveProperty('align', e.target.value)}>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </div>
        </>
      );
      layoutFields = null;
      advancedFields = (
        <div className={styles.fieldGroup}>
          <label>Mobile Font Size Override</label>
          <input placeholder="e.g. 18px" value={parsedConfig.mobile_font_size || ''} onChange={e => handleUpdateActiveProperty('mobile_font_size', e.target.value, undefined, true)} onBlur={commitToHistory} />
        </div>
      );
    }

    else if (comp.type === 'Paragraph') {
      typographyFields = (
        <>
          <div className={styles.fieldGroup}>
            <label>Paragraph Body Text</label>
            <textarea rows={4} value={parsedConfig.text || ''} onChange={e => handleUpdateActiveProperty('text', e.target.value, undefined, true)} onBlur={commitToHistory} />
          </div>
          <div className={styles.fieldGroup}>
            <label>Custom Text Font Size (Desktop)</label>
            <input placeholder="e.g. 15px, 18px, 1.1rem" value={parsedConfig.font_size || ''} onChange={e => handleUpdateActiveProperty('font_size', e.target.value, undefined, true)} onBlur={commitToHistory} />
          </div>
          {renderColorPickerField('Text Custom Color', parsedConfig.color, '#4B5563', (val) => handleUpdateActiveProperty('color', val), 'inherit')}
          <div className={styles.fieldGroup}>
            <label>Alignment</label>
            <select value={parsedConfig.align || 'left'} onChange={e => handleUpdateActiveProperty('align', e.target.value)}>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </div>
        </>
      );
      layoutFields = null;
      advancedFields = (
        <div className={styles.fieldGroup}>
          <label>Mobile Font Size Override</label>
          <input placeholder="e.g. 14px" value={parsedConfig.mobile_font_size || ''} onChange={e => handleUpdateActiveProperty('mobile_font_size', e.target.value, undefined, true)} onBlur={commitToHistory} />
        </div>
      );
    }

    else if (comp.type === 'Button') {
      styleFields = (
        <>
          <div className={styles.fieldGroup}>
            <label>Button Label Text</label>
            <input value={parsedConfig.text || ''} onChange={e => handleUpdateActiveProperty('text', e.target.value, undefined, true)} onBlur={commitToHistory} />
          </div>
          <div className={styles.fieldGroup}>
            <label>Button Style Type</label>
            <select value={parsedConfig.style || 'primary'} onChange={e => handleUpdateActiveProperty('style', e.target.value)}>
              <option value="primary">Primary Solid</option>
              <option value="outline">Outlined Border</option>
              <option value="flat">Flat Text</option>
            </select>
          </div>
          {renderColorPickerField('Background Color', parsedConfig.color, '#4F46E5', (val) => handleUpdateActiveProperty('color', val))}
          {renderColorPickerField('Text Color', parsedConfig.text_color, '#FFFFFF', (val) => handleUpdateActiveProperty('text_color', val), 'inherit')}
          <div className={styles.fieldGroup}>
            <label>Border Radius</label>
            <input placeholder="e.g. 6px" value={parsedConfig.border_radius || ''} onChange={e => handleUpdateActiveProperty('border_radius', e.target.value, undefined, true)} onBlur={commitToHistory} />
          </div>
        </>
      );
      layoutFields = (
        <>
          <div className={styles.fieldGroup}>
            <label>Alignment</label>
            <select value={parsedConfig.alignment || 'center'} onChange={e => handleUpdateActiveProperty('alignment', e.target.value)}>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </div>
          <div className={styles.fieldGroup}>
            <label>Button Size</label>
            <select value={parsedConfig.size || 'medium'} onChange={e => handleUpdateActiveProperty('size', e.target.value)}>
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
            </select>
          </div>
          <div className={styles.fieldGroup} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input type="checkbox" id="btnFullWidthOpt" checked={!!parsedConfig.full_width} onChange={e => handleUpdateActiveProperty('full_width', e.target.checked)} />
            <label htmlFor="btnFullWidthOpt">Display Full Width (100%)</label>
          </div>
        </>
      );
      advancedFields = (
        <>
          <div className={styles.fieldGroup}>
            <label>Click Action Link Type</label>
            <select value={parsedConfig.action_type || (parsedConfig.action_value || parsedConfig.url ? 'open_external_url' : 'go_to_next_step')} onChange={e => {
              handleUpdateActiveProperty('action_type', e.target.value);
            }}>
              <option value="open_external_url">Open External URL</option>
              <option value="go_to_next_step">Go to Next Funnel Step</option>
              <option value="go_to_specific_step">Go to Specific Step</option>
              <option value="download_file">Download Asset File</option>
              <option value="scroll_to_section">Scroll to Section Anchor</option>
            </select>
          </div>
          <div className={styles.fieldGroup}>
            <label>Action Target/URL Value</label>
            <input
              placeholder="e.g. www.google.com or #features"
              value={parsedConfig.action_value || parsedConfig.url || ''}
              onChange={e => {
                const val = e.target.value;
                handleUpdateActiveProperty('action_value', val, undefined, true);
                handleUpdateActiveProperty('url', val, undefined, true);
                if (val && (!parsedConfig.action_type || parsedConfig.action_type === 'go_to_next_step')) {
                  handleUpdateActiveProperty('action_type', 'open_external_url', undefined, true);
                }
              }}
              onBlur={commitToHistory}
            />
          </div>
        </>
      );
    }

    else if (comp.type === 'Image') {
      styleFields = (
        <>
          <div className={styles.fieldGroup}>
            <label>Image Source URL</label>
            <div className={styles.mediaUrlInputRow}>
              <input value={parsedConfig.url || ''} onChange={e => handleUpdateActiveProperty('url', e.target.value, undefined, true)} onBlur={commitToHistory} />
              <button type="button" className={styles.uploadTriggerBtn} onClick={() => openMediaSelector((url) => { handleUpdateActiveProperty('url', url); commitToHistory(); })}>Pick</button>
            </div>
          </div>
          <div className={styles.fieldGroup}>
            <label>Corner Rounding (Border Radius)</label>
            <input placeholder="e.g. 8px" value={parsedConfig.border_radius || ''} onChange={e => handleUpdateActiveProperty('border_radius', e.target.value, undefined, true)} onBlur={commitToHistory} />
          </div>
        </>
      );
      layoutFields = (
        <>
          <div className={styles.fieldGroup}>
            <label>Width Size</label>
            <input placeholder="e.g. 100% or 300px" value={parsedConfig.width || ''} onChange={e => handleUpdateActiveProperty('width', e.target.value, undefined, true)} onBlur={commitToHistory} />
          </div>
          <div className={styles.fieldGroup}>
            <label>Alignment</label>
            <select value={parsedConfig.align || 'center'} onChange={e => handleUpdateActiveProperty('align', e.target.value)}>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </div>
        </>
      );
      advancedFields = (
        <div className={styles.fieldGroup}>
          <label>Image Alt Text</label>
          <input value={parsedConfig.alt || ''} onChange={e => handleUpdateActiveProperty('alt', e.target.value, undefined, true)} onBlur={commitToHistory} />
        </div>
      );
    }

    else if (comp.type === 'Video') {
      styleFields = (
        <div className={styles.fieldGroup}>
          <label>Video URL (MP4, YouTube, Vimeo, Live)</label>
          <div className={styles.mediaUrlInputRow}>
            <input placeholder="e.g. YouTube URL or direct MP4 link" value={parsedConfig.url || ''} onChange={e => handleUpdateActiveProperty('url', e.target.value, undefined, true)} onBlur={commitToHistory} />
            <button type="button" className={styles.uploadTriggerBtn} onClick={() => openMediaSelector((url) => { handleUpdateActiveProperty('url', url); commitToHistory(); })}>Pick</button>
          </div>
        </div>
      );
      layoutFields = (
        <div className={styles.fieldGroup}>
          <label>Aspect Ratio</label>
          <select value={parsedConfig.ratio || '16:9'} onChange={e => handleUpdateActiveProperty('ratio', e.target.value)}>
            <option value="16:9">16:9 widescreen</option>
            <option value="4:3">4:3 standard</option>
            <option value="1:1">1:1 square</option>
            <option value="21:9">21:9 cinematic</option>
            <option value="9:16">9:16 vertical</option>
          </select>
        </div>
      );
      advancedFields = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input type="checkbox" id="videoAutoplayOpt" checked={!!parsedConfig.autoplay} onChange={e => handleUpdateActiveProperty('autoplay', e.target.checked)} />
            <label htmlFor="videoAutoplayOpt">Autoplay (muted)</label>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input type="checkbox" id="videoControlsOpt" checked={parsedConfig.controls !== false} onChange={e => handleUpdateActiveProperty('controls', e.target.checked)} />
            <label htmlFor="videoControlsOpt">Show Player Controls</label>
          </div>
        </div>
      );
    }

    else if (comp.type === 'Form') {
      styleFields = (
        <>
          <div className={styles.fieldGroup}>
            <label>Submit Button Text</label>
            <input value={parsedConfig.submit_text || 'Submit Form'} onChange={e => handleUpdateActiveProperty('submit_text', e.target.value, undefined, true)} onBlur={commitToHistory} />
          </div>

          {/* Button Style Group */}
          <div style={{ borderTop: '1px solid #E2E8F0', paddingTop: '12px', marginTop: '12px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#4F46E5', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>Button Formatting</div>
            <div className={styles.fieldGroup}>
              <label>Button Background Color</label>
              <input type="color" value={parsedConfig.button_bg_color || '#4F46E5'} onChange={e => handleUpdateActiveProperty('button_bg_color', e.target.value)} />
            </div>
            <div className={styles.fieldGroup}>
              <label>Button Text Color</label>
              <input type="color" value={parsedConfig.button_text_color || '#ffffff'} onChange={e => handleUpdateActiveProperty('button_text_color', e.target.value)} />
            </div>
            <div className={styles.fieldGroup}>
              <label>Button Font Size</label>
              <select value={parsedConfig.button_font_size || '14px'} onChange={e => handleUpdateActiveProperty('button_font_size', e.target.value)}>
                <option value="12px">12px (Small)</option>
                <option value="14px">14px (Medium)</option>
                <option value="16px">16px (Large)</option>
                <option value="18px">18px (XL)</option>
                <option value="20px">20px (Huge)</option>
              </select>
            </div>
            <div className={styles.fieldGroup}>
              <label>Button Font Weight</label>
              <select value={parsedConfig.button_font_weight || '700'} onChange={e => handleUpdateActiveProperty('button_font_weight', e.target.value)}>
                <option value="500">Medium (500)</option>
                <option value="600">Semi-Bold (600)</option>
                <option value="700">Bold (700)</option>
                <option value="800">Extra Bold (800)</option>
              </select>
            </div>
            <div className={styles.fieldGroup}>
              <label>Button Border Radius</label>
              <select value={parsedConfig.button_border_radius || '8px'} onChange={e => handleUpdateActiveProperty('button_border_radius', e.target.value)}>
                <option value="4px">4px (Sharp)</option>
                <option value="8px">8px (Rounded)</option>
                <option value="12px">12px (Smooth)</option>
                <option value="24px">24px (Pill)</option>
              </select>
            </div>
          </div>

          {/* Labels & Typography Group */}
          <div style={{ borderTop: '1px solid #E2E8F0', paddingTop: '12px', marginTop: '12px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#4F46E5', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>Label Formatting</div>
            <div className={styles.fieldGroup}>
              <label>Label Text Color</label>
              <input type="color" value={parsedConfig.label_color || '#1E293B'} onChange={e => handleUpdateActiveProperty('label_color', e.target.value)} />
            </div>
            <div className={styles.fieldGroup}>
              <label>Label Font Size</label>
              <select value={parsedConfig.label_font_size || '12px'} onChange={e => handleUpdateActiveProperty('label_font_size', e.target.value)}>
                <option value="11px">11px (Compact)</option>
                <option value="12px">12px (Normal)</option>
                <option value="14px">14px (Medium)</option>
                <option value="16px">16px (Large)</option>
              </select>
            </div>
            <div className={styles.fieldGroup}>
              <label>Label Font Weight</label>
              <select value={parsedConfig.label_font_weight || '600'} onChange={e => handleUpdateActiveProperty('label_font_weight', e.target.value)}>
                <option value="400">Normal (400)</option>
                <option value="500">Medium (500)</option>
                <option value="600">Semi-Bold (600)</option>
                <option value="700">Bold (700)</option>
              </select>
            </div>
          </div>

          {/* Inputs & Fields Group */}
          <div style={{ borderTop: '1px solid #E2E8F0', paddingTop: '12px', marginTop: '12px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#4F46E5', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>Input Fields Formatting</div>
            <div className={styles.fieldGroup}>
              <label>Input Background Color</label>
              <input type="color" value={parsedConfig.input_bg_color || '#ffffff'} onChange={e => handleUpdateActiveProperty('input_bg_color', e.target.value)} />
            </div>
            <div className={styles.fieldGroup}>
              <label>Input Text Color</label>
              <input type="color" value={parsedConfig.input_text_color || '#111827'} onChange={e => handleUpdateActiveProperty('input_text_color', e.target.value)} />
            </div>
            <div className={styles.fieldGroup}>
              <label>Input Border Color</label>
              <input type="color" value={parsedConfig.input_border_color || '#CBD5E1'} onChange={e => handleUpdateActiveProperty('input_border_color', e.target.value)} />
            </div>
            <div className={styles.fieldGroup}>
              <label>Input Border Radius</label>
              <select value={parsedConfig.input_border_radius || '8px'} onChange={e => handleUpdateActiveProperty('input_border_radius', e.target.value)}>
                <option value="4px">4px (Sharp)</option>
                <option value="8px">8px (Rounded)</option>
                <option value="12px">12px (Smooth)</option>
                <option value="24px">24px (Pill)</option>
              </select>
            </div>
          </div>

          {/* Card Formatting */}
          <div style={{ borderTop: '1px solid #E2E8F0', paddingTop: '12px', marginTop: '12px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#4F46E5', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>Card Formatting</div>
            <div className={styles.fieldGroup}>
              <label>Card Background Color</label>
              <input type="color" value={parsedConfig.form_bg_color || '#F8FAFC'} onChange={e => handleUpdateActiveProperty('form_bg_color', e.target.value)} />
            </div>
            <div className={styles.fieldGroup}>
              <label>Card Border Color</label>
              <input type="color" value={parsedConfig.form_border_color || '#E2E8F0'} onChange={e => handleUpdateActiveProperty('form_border_color', e.target.value)} />
            </div>
            <div className={styles.fieldGroup}>
              <label>Card Shadow</label>
              <select value={parsedConfig.form_shadow || 'none'} onChange={e => handleUpdateActiveProperty('form_shadow', e.target.value)}>
                <option value="none">None</option>
                <option value="modern">Soft Modern Shadow</option>
                <option value="elevation">Elevation Shadow</option>
              </select>
            </div>
          </div>
        </>
      );
      advancedFields = (
        <>
          <div className={styles.fieldGroup}>
            <label>Select CRM Contact Form</label>
            <select value={parsedConfig.form_id || ''} onChange={e => handleUpdateActiveProperty('form_id', e.target.value)}>
              <option value="">-- Choose Form --</option>
              {forms.map(f => <option key={f.id} value={f.id}>{f.title}</option>)}
            </select>
          </div>
          <div className={styles.fieldGroup}>
            <label>Redirect URL after Success</label>
            <input placeholder="e.g. /thank-you" value={parsedConfig.redirect_url || ''} onChange={e => handleUpdateActiveProperty('redirect_url', e.target.value, undefined, true)} onBlur={commitToHistory} />
          </div>
        </>
      );
    }

    else if (comp.type === 'Calendar') {
      advancedFields = (
        <>
          <div className={styles.fieldGroup}>
            <label>Calendar Title</label>
            <input
              type="text"
              value={parsedConfig.title || 'Book an Appointment'}
              onChange={e => handleUpdateActiveProperty('title', e.target.value)}
              placeholder="e.g. Schedule a Strategy Call"
            />
          </div>
          <div className={styles.fieldGroup}>
            <label>Subheading / Instructions</label>
            <input
              type="text"
              value={parsedConfig.subtitle || 'Select a date and available time slot below'}
              onChange={e => handleUpdateActiveProperty('subtitle', e.target.value)}
              placeholder="e.g. Pick a time that works best for you"
            />
          </div>
          <div className={styles.fieldGroup}>
            <label>Available Days</label>
            <select
              value={parsedConfig.available_days || 'weekdays'}
              onChange={e => handleUpdateActiveProperty('available_days', e.target.value)}
            >
              <option value="weekdays">Monday - Friday (Weekdays)</option>
              <option value="mon_sat">Monday - Saturday</option>
              <option value="all">All Days (Monday - Sunday)</option>
            </select>
          </div>
          <div className={styles.fieldGroup}>
            <label>Working Hours Start</label>
            <select
              value={parsedConfig.start_hour || '09:00 AM'}
              onChange={e => handleUpdateActiveProperty('start_hour', e.target.value)}
            >
              <option value="08:00 AM">08:00 AM</option>
              <option value="09:00 AM">09:00 AM</option>
              <option value="10:00 AM">10:00 AM</option>
              <option value="11:00 AM">11:00 AM</option>
            </select>
          </div>
          <div className={styles.fieldGroup}>
            <label>Working Hours End</label>
            <select
              value={parsedConfig.end_hour || '05:00 PM'}
              onChange={e => handleUpdateActiveProperty('end_hour', e.target.value)}
            >
              <option value="04:00 PM">04:00 PM</option>
              <option value="05:00 PM">05:00 PM</option>
              <option value="06:00 PM">06:00 PM</option>
              <option value="07:00 PM">07:00 PM</option>
              <option value="08:00 PM">08:00 PM</option>
            </select>
          </div>
          <div className={styles.fieldGroup}>
            <label>Slot Duration</label>
            <select
              value={parsedConfig.duration || '30'}
              onChange={e => handleUpdateActiveProperty('duration', e.target.value)}
            >
              <option value="15">15 Minutes</option>
              <option value="30">30 Minutes</option>
              <option value="45">45 Minutes</option>
              <option value="60">60 Minutes (1 Hour)</option>
            </select>
          </div>
          <div className={styles.fieldGroup}>
            <label>Primary Theme Color</label>
            <select
              value={parsedConfig.theme_color || '#4F46E5'}
              onChange={e => handleUpdateActiveProperty('theme_color', e.target.value)}
            >
              <option value="#4F46E5">Indigo / Purple</option>
              <option value="#2563EB">Royal Blue</option>
              <option value="#059669">Emerald Green</option>
              <option value="#D97706">Amber Gold</option>
              <option value="#DC2626">Crimson Red</option>
            </select>
          </div>
          <div className={styles.fieldGroup}>
            <label>Assign Salesperson</label>
            <select
              value={parsedConfig.assigned_to_id || 'default_calendar'}
              onChange={e => handleUpdateActiveProperty('assigned_to_id', e.target.value)}
            >
              <option value="default_calendar">Auto-assign (Default / Connected Sales Rep)</option>
              {teamMembers.map(m => (
                <option key={m.id} value={m.id}>
                  {m.first_name} {m.last_name} ({m.role || 'Sales Rep'})
                </option>
              ))}
            </select>
          </div>
        </>
      );
    }

    else if (comp.type === 'Countdown') {
      typographyFields = (
        <>
          <div className={styles.fieldGroup}>
            <label>Target Date-Time</label>
            <input type="datetime-local" value={parsedConfig.target_date || ''} onChange={e => handleUpdateActiveProperty('target_date', e.target.value)} />
          </div>
          <div className={styles.fieldGroup}>
            <label>Heading / Label Text (Optional)</label>
            <input placeholder="e.g. Special Offer Ends In:" value={parsedConfig.label || ''} onChange={e => handleUpdateActiveProperty('label', e.target.value, undefined, true)} onBlur={commitToHistory} />
          </div>
          <div className={styles.fieldGroup}>
            <label>Expired Message</label>
            <input placeholder="e.g. Offer Expired!" value={parsedConfig.expired_message || ''} onChange={e => handleUpdateActiveProperty('expired_message', e.target.value, undefined, true)} onBlur={commitToHistory} />
          </div>
          <div className={styles.fieldGroup}>
            <label>Display Format</label>
            <select value={parsedConfig.format || 'days_hours_minutes_seconds'} onChange={e => handleUpdateActiveProperty('format', e.target.value)}>
              <option value="days_hours_minutes_seconds">Days, Hours, Mins, Secs Blocks</option>
              <option value="hms">Hours:Minutes:Seconds (00:00:00)</option>
              <option value="ms">Minutes:Seconds (00:00)</option>
            </select>
          </div>
        </>
      );
      styleFields = (
        <>
          {renderColorPickerField('Box Background Color', parsedConfig.bg_color, '#F3F4F6', (val) => handleUpdateActiveProperty('bg_color', val))}
          {renderColorPickerField('Digits & Text Color', parsedConfig.text_color, '#111827', (val) => handleUpdateActiveProperty('text_color', val), 'inherit')}
          <div className={styles.fieldGroup}>
            <label>Corner Radius</label>
            <input placeholder="e.g. 16px" value={parsedConfig.border_radius || ''} onChange={e => handleUpdateActiveProperty('border_radius', e.target.value, undefined, true)} onBlur={commitToHistory} />
          </div>
        </>
      );
      layoutFields = (
        <>
          <div className={styles.fieldGroup}>
            <label>Alignment</label>
            <select value={parsedConfig.align || parsedConfig.alignment || 'center'} onChange={e => {
              handleUpdateActiveProperty('align', e.target.value);
              handleUpdateActiveProperty('alignment', e.target.value);
            }}>
              <option value="left">Left Aligned</option>
              <option value="center">Center Aligned</option>
              <option value="right">Right Aligned</option>
            </select>
          </div>
          <div className={styles.fieldGroup}>
            <label>Size Preset</label>
            <select value={parsedConfig.size || 'medium'} onChange={e => handleUpdateActiveProperty('size', e.target.value)}>
              <option value="small">Small (Compact)</option>
              <option value="medium">Medium (Standard)</option>
              <option value="large">Large (Prominent)</option>
              <option value="custom">Custom Font Size</option>
            </select>
          </div>
          {parsedConfig.size === 'custom' && (
            <div className={styles.fieldGroup}>
              <label>Custom Digit Size (px)</label>
              <input placeholder="e.g. 36px" value={parsedConfig.font_size || ''} onChange={e => handleUpdateActiveProperty('font_size', e.target.value, undefined, true)} onBlur={commitToHistory} />
            </div>
          )}
          <div className={styles.fieldGroup}>
            <label>Container Max Width</label>
            <select value={parsedConfig.max_width || '100%'} onChange={e => handleUpdateActiveProperty('max_width', e.target.value)}>
              <option value="100%">Full Width (100%)</option>
              <option value="600px">Large (600px)</option>
              <option value="450px">Medium (450px)</option>
              <option value="320px">Small (320px)</option>
            </select>
          </div>
        </>
      );
      advancedFields = (
        <div className={styles.fieldGroup}>
          <label>Mobile Digit Size Override (px)</label>
          <input placeholder="e.g. 20px" value={parsedConfig.mobile_font_size || ''} onChange={e => handleUpdateActiveProperty('mobile_font_size', e.target.value, undefined, true)} onBlur={commitToHistory} />
        </div>
      );
    }

    else if (comp.type === 'Spacer') {
      layoutFields = (
        <div className={styles.fieldGroup}>
          <label>Height Dimension (px)</label>
          <input placeholder="e.g. 24px" value={parsedConfig.height || ''} onChange={e => handleUpdateActiveProperty('height', e.target.value, undefined, true)} onBlur={commitToHistory} />
        </div>
      );
    }

    else if (comp.type === 'Divider') {
      styleFields = (
        <>
          <div className={styles.fieldGroup}>
            <label>Line Thickness (px)</label>
            <input placeholder="e.g. 1px" value={parsedConfig.thickness || ''} onChange={e => handleUpdateActiveProperty('thickness', e.target.value, undefined, true)} onBlur={commitToHistory} />
          </div>
          {renderColorPickerField('Divider Custom Color', parsedConfig.color, '#e5e7eb', (val) => handleUpdateActiveProperty('color', val))}
        </>
      );
      layoutFields = (
        <div className={styles.fieldGroup}>
          <label>Margin spacing</label>
          <input placeholder="e.g. 12px 0" value={parsedConfig.margin || ''} onChange={e => handleUpdateActiveProperty('margin', e.target.value, undefined, true)} onBlur={commitToHistory} />
        </div>
      );
    }

    else if (comp.type === 'CustomHTML') {
      advancedFields = (
        <div className={styles.fieldGroup}>
          <label>Custom HTML Code</label>
          <textarea rows={6} value={parsedConfig.code || ''} onChange={e => handleUpdateActiveProperty('code', e.target.value, undefined, true)} onBlur={commitToHistory} />
        </div>
      );
    }

    else if (comp.type === 'SocialLinks') {
      styleFields = (
        <>
          <div className={styles.fieldGroup}>
            <label>Display Mode</label>
            <select value={parsedConfig.display_mode || 'icons'} onChange={e => handleUpdateActiveProperty('display_mode', e.target.value)}>
              <option value="icons">SVG Brand Logos (Footer Style)</option>
              <option value="text_badges">Text Pill Badges</option>
              <option value="both">Logos + Text Labels</option>
            </select>
          </div>
          <div className={styles.fieldGroup}>
            <label>Alignment</label>
            <select value={parsedConfig.shape ? (parsedConfig.align || parsedConfig.alignment || 'center') : (parsedConfig.alignment || parsedConfig.align || 'center')} onChange={e => {
              const val = e.target.value;
              handleUpdateActiveProperties({ align: val, alignment: val });
            }}>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </div>
          <div className={styles.fieldGroup}>
            <label>Icon / Badge Size (px)</label>
            <input type="number" min={16} max={80} value={parsedConfig.size || parsedConfig.icon_size || 40} onChange={e => {
              const val = Number(e.target.value);
              handleUpdateActiveProperties({ size: val, icon_size: val });
            }} />
          </div>
          <div className={styles.fieldGroup}>
            <label>Theme Style</label>
            <select value={parsedConfig.icon_style || (parsedConfig.filled !== false ? 'filled' : 'outlined')} onChange={e => {
              const val = e.target.value;
              handleUpdateActiveProperties({ icon_style: val, filled: val === 'filled', outlined: val === 'outlined' });
            }}>
              <option value="filled">Filled (Brand Color Background)</option>
              <option value="outlined">Outlined (Colored Border)</option>
              <option value="flat">Flat (Glyph Only, Transparent BG)</option>
            </select>
          </div>
          <div className={styles.fieldGroup}>
            <label>Icon Shape Style</label>
            <select value={parsedConfig.shape || parsedConfig.icon_shape || 'circle'} onChange={e => {
              const val = e.target.value;
              handleUpdateActiveProperties({ shape: val, icon_shape: val });
            }}>
              <option value="circle">Perfect Circle</option>
              <option value="rounded">Rounded Corners</option>
              <option value="square">Square</option>
            </select>
          </div>
          {renderColorPickerField('Custom Brand Color Override (Optional)', parsedConfig.custom_color, '', (val) => handleUpdateActiveProperty('custom_color', val), 'inherit')}
          <div className={styles.fieldGroup}>
            <label>Facebook URL</label>
            <input value={parsedConfig.facebook || ''} onChange={e => handleUpdateActiveProperty('facebook', e.target.value, undefined, true)} onBlur={commitToHistory} />
          </div>
          <div className={styles.fieldGroup}>
            <label>Twitter / X URL</label>
            <input value={parsedConfig.twitter || parsedConfig.x || ''} onChange={e => handleUpdateActiveProperty('twitter', e.target.value, undefined, true)} onBlur={commitToHistory} />
          </div>
          <div className={styles.fieldGroup}>
            <label>Instagram URL</label>
            <input value={parsedConfig.instagram || ''} onChange={e => handleUpdateActiveProperty('instagram', e.target.value, undefined, true)} onBlur={commitToHistory} />
          </div>
          <div className={styles.fieldGroup}>
            <label>LinkedIn URL</label>
            <input value={parsedConfig.linkedin || ''} onChange={e => handleUpdateActiveProperty('linkedin', e.target.value, undefined, true)} onBlur={commitToHistory} />
          </div>
          <div className={styles.fieldGroup}>
            <label>YouTube URL</label>
            <input value={parsedConfig.youtube || ''} onChange={e => handleUpdateActiveProperty('youtube', e.target.value, undefined, true)} onBlur={commitToHistory} />
          </div>
          <div className={styles.fieldGroup}>
            <label>WhatsApp URL</label>
            <input value={parsedConfig.whatsapp || ''} onChange={e => handleUpdateActiveProperty('whatsapp', e.target.value, undefined, true)} onBlur={commitToHistory} />
          </div>
          <div className={styles.fieldGroup}>
            <label>GitHub URL</label>
            <input value={parsedConfig.github || ''} onChange={e => handleUpdateActiveProperty('github', e.target.value, undefined, true)} onBlur={commitToHistory} />
          </div>
          <div className={styles.fieldGroup}>
            <label>TikTok URL</label>
            <input value={parsedConfig.tiktok || ''} onChange={e => handleUpdateActiveProperty('tiktok', e.target.value, undefined, true)} onBlur={commitToHistory} />
          </div>
        </>
      );
    }

    else if (comp.type === 'FAQ') {
      advancedFields = (
        <>
          <div className={styles.fieldGroup}>
            <label style={{ fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>FAQ Items List</span>
              <button type="button" className={styles.createBtn} style={{ padding: '4px 8px', fontSize: '11px', borderRadius: '4px' }} onClick={() => {
                const items = parsedConfig.items || [];
                const nextItems = [...items, { question: 'New Question', answer: 'Answer text', default_open: false }];
                handleUpdateActiveProperty('items', nextItems);
              }}>+ Add FAQ</button>
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '10px', maxHeight: '350px', overflowY: 'auto', paddingRight: '4px' }}>
              {(parsedConfig.items || []).map((faq: any, fIdx: number) => (
                <div key={fIdx} style={{ border: '1px solid #E2E8F0', borderRadius: '8px', padding: '10px', background: '#F8FAFC', position: 'relative' }}>
                  <input style={{ padding: '4px', fontSize: '11px', width: '100%', marginBottom: '4px' }} value={faq.question || ''} onChange={e => {
                    const items = [...parsedConfig.items];
                    items[fIdx] = { ...items[fIdx], question: e.target.value };
                    handleUpdateActiveProperty('items', items);
                  }} />
                  <textarea rows={2} style={{ padding: '4px', fontSize: '11px', width: '100%' }} value={faq.answer || ''} onChange={e => {
                    const items = [...parsedConfig.items];
                    items[fIdx] = { ...items[fIdx], answer: e.target.value };
                    handleUpdateActiveProperty('items', items);
                  }} />
                </div>
              ))}
            </div>
          </div>
        </>
      );
    }

    else if (comp.type === 'Testimonials') {
      const items = parsedConfig.items || parsedConfig.testimonials || [];
      advancedFields = (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <label style={{ fontWeight: 700, fontSize: '12px' }}>Testimonials List</label>
            <button type="button" className={styles.createBtn} style={{ padding: '4px 8px', fontSize: '11px', borderRadius: '4px' }} onClick={() => {
              const updated = [...items, { author: 'Customer Name', company: 'Company Name', role: 'Company Name', quote: 'Review quote text...', rating: 5, avatar_url: '' }];
              handleUpdateActiveProperties({ items: updated, testimonials: updated });
            }}>+ Add Review</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '420px', overflowY: 'auto' }}>
            {items.map((test: any, tIdx: number) => (
              <div key={tIdx} style={{ border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px', background: '#f8fafc', position: 'relative' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: '#4F46E5' }}>Review #{tIdx + 1}</span>
                  <button type="button" style={{ border: 'none', background: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '14px', fontWeight: 700 }} onClick={() => {
                    const updated = items.filter((_: any, idx: number) => idx !== tIdx);
                    handleUpdateActiveProperties({ items: updated, testimonials: updated });
                  }}>✕</button>
                </div>
                <div className={styles.fieldGroup} style={{ marginBottom: '6px' }}>
                  <label style={{ fontSize: '10px' }}>Customer Name</label>
                  <input style={{ padding: '4px 8px', fontSize: '11px', width: '100%' }} value={test.author || test.name || ''} onChange={e => {
                    const list = [...items];
                    list[tIdx] = { ...list[tIdx], author: e.target.value, name: e.target.value };
                    handleUpdateActiveProperties({ items: list, testimonials: list });
                  }} />
                </div>
                <div className={styles.fieldGroup} style={{ marginBottom: '6px' }}>
                  <label style={{ fontSize: '10px' }}>Company Name / Designation</label>
                  <input placeholder="e.g. Acme Corp / CEO" style={{ padding: '4px 8px', fontSize: '11px', width: '100%' }} value={test.company || test.role || test.designation || ''} onChange={e => {
                    const list = [...items];
                    list[tIdx] = { ...list[tIdx], company: e.target.value, role: e.target.value, designation: e.target.value };
                    handleUpdateActiveProperties({ items: list, testimonials: list });
                  }} />
                </div>
                <div className={styles.fieldGroup} style={{ marginBottom: '6px' }}>
                  <label style={{ fontSize: '10px' }}>Rating Stars</label>
                  <select style={{ padding: '4px 8px', fontSize: '11px', width: '100%' }} value={test.rating || 5} onChange={e => {
                    const list = [...items];
                    list[tIdx] = { ...list[tIdx], rating: Number(e.target.value) };
                    handleUpdateActiveProperties({ items: list, testimonials: list });
                  }}>
                    <option value={5}>★★★★★ (5 Stars)</option>
                    <option value={4}>★★★★☆ (4 Stars)</option>
                    <option value={3}>★★★☆☆ (3 Stars)</option>
                    <option value={2}>★★☆☆☆ (2 Stars)</option>
                    <option value={1}>★☆☆☆☆ (1 Star)</option>
                  </select>
                </div>
                <div className={styles.fieldGroup}>
                  <label style={{ fontSize: '10px' }}>Review Quote</label>
                  <textarea rows={2} style={{ padding: '4px 8px', fontSize: '11px', width: '100%' }} value={test.quote || test.content || ''} onChange={e => {
                    const list = [...items];
                    list[tIdx] = { ...list[tIdx], quote: e.target.value, content: e.target.value };
                    handleUpdateActiveProperties({ items: list, testimonials: list });
                  }} />
                </div>
              </div>
            ))}
          </div>
        </>
      );
    }

    else if (comp.type === 'Icons') {
      styleFields = (
        <>
          <div className={styles.fieldGroup}>
            <label>Select SVG Icon</label>
            <select value={parsedConfig.icon_name || 'Check'} onChange={e => handleUpdateActiveProperty('icon_name', e.target.value)}>
              {Object.entries(ICON_SVG_LIBRARY).map(([key, item]) => (
                <option key={key} value={key}>{item.label}</option>
              ))}
            </select>
          </div>
          <div className={styles.fieldGroup}>
            <label>Icon Size (px)</label>
            <input type="number" min={8} value={parsedConfig.size || 24} onChange={e => handleUpdateActiveProperty('size', Number(e.target.value))} />
          </div>
          {renderColorPickerField('Icon Color', parsedConfig.color, '#4F46E5', (val) => handleUpdateActiveProperty('color', val), 'inherit')}
        </>
      );
      layoutFields = (
        <div className={styles.fieldGroup}>
          <label>Alignment</label>
          <select value={parsedConfig.alignment || 'center'} onChange={e => handleUpdateActiveProperty('alignment', e.target.value)}>
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </div>
      );
    }

    return (
      <>
        {(layoutFields || styleFields || typographyFields || advancedFields) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', paddingBottom: '16px', borderBottom: '1.5px solid #E2E8F0', marginBottom: '16px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#1E293B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Component Properties</div>
            {layoutFields}
            {styleFields}
            {typographyFields}
            {advancedFields}
          </div>
        )}
        {renderUniversalLayoutInspector()}
      </>
    );
  };

  const handleEditStepStart = (step: FunnelStep) => {
    setEditingStep(step);
    setActiveViewMode('desktop');
    setActiveElement({ type: 'page', id: 'page' });

    let layout: any = null;
    if (step.page_content) {
      try {
        layout = JSON.parse(step.page_content);
      } catch { }
    }

    if (!layout || !layout.sections || layout.sections.length === 0) {
      // Build default wrapping layout
      const comps = step.components || [];
      const layoutComps = comps.map(c => ({
        id: c.id || `comp_${Math.random().toString(36).substring(2, 7)}`,
        type: c.type,
        config: typeof c.config === 'string' ? c.config : JSON.stringify(c.config || {})
      }));

      layout = {
        sections: [
          {
            id: `sec_default_${step.id}`,
            name: "Default Section",
            type: "Blank Section",
            settings: {
              padding: "40px 0",
              margin: "0",
              container_width: "container",
              visibility: "both"
            },
            rows: [
              {
                id: `row_default_${step.id}`,
                settings: {},
                columns: [
                  {
                    id: `col_default_${step.id}`,
                    width: "100%",
                    settings: {},
                    components: layoutComps
                  }
                ]
              }
            ]
          }
        ],
        globalSettings: {
          seo_title: step.name,
          meta_description: "",
          og_image: "",
          custom_css: "",
          custom_js: "",
          body_width: "100%",
          theme_colors: {
            primary: "#4F46E5",
            secondary: "#10B981",
            accent: "#F59E0B"
          }
        },
        designSystem: {
          primary_color: "#4F46E5",
          secondary_color: "#10B981",
          accent_color: "#F59E0B",
          fonts: "Inter",
          button_style: "solid",
          border_radius: "8px"
        }
      };
    }

    // Check for local storage autosave recovery draft
    const draft = localStorage.getItem(`growthos_funnel_step_draft_${step.id}`);
    if (draft) {
      try {
        const parsedDraft = JSON.parse(draft);
        setRestorableLayout(parsedDraft);
        setIsAutosaveRestorable(true);
      } catch { }
    }

    setPageLayout(layout);
    setHistory([layout]);
    setHistoryIndex(0);
    setEditingComponentIndex(null);
  };

  const handleSaveStep = async (keepOpen: boolean = false) => {
    if (!selectedFunnel || !editingStep || savingStep) return;
    if (!editingStep.name || !editingStep.name.trim()) {
      showToast('Step name/type cannot be empty.', 'error');
      return;
    }

    // Validate CTA Button configurations inside layout
    if (pageLayout && pageLayout.sections) {
      for (const section of pageLayout.sections) {
        if (section.rows) {
          for (const row of section.rows) {
            if (row.columns) {
              for (const col of row.columns) {
                if (col.components) {
                  for (const comp of col.components) {
                    if (comp.type === 'Button') {
                      let cfg: any = {};
                      try {
                        cfg = typeof comp.config === 'string' ? JSON.parse(comp.config || '{}') : (comp.config || {});
                      } catch { }

                      const action = cfg.action_type || 'go_to_next_step';
                      const val = cfg.action_value;

                      if (action === 'external_url') {
                        if (!val || !val.trim()) {
                          showToast('CTA Button Error: External URL action requires a destination URL.', 'error');
                          return;
                        }
                        try {
                          if (!val.startsWith('#') && !val.startsWith('/') && !val.startsWith('mailto:') && !val.startsWith('tel:')) {
                            let norm = val;
                            if (!/^https?:\/\//i.test(norm)) {
                              norm = 'https://' + norm;
                            }
                            new URL(norm);
                          }
                        } catch (e) {
                          showToast('CTA Button Error: External URL is malformed.', 'error');
                          return;
                        }
                      } else if (action === 'go_to_specific_step') {
                        if (!val || !val.trim()) {
                          showToast('CTA Button Error: Specific step action requires choosing a target step.', 'error');
                          return;
                        }
                      } else if (action === 'scroll_to_section') {
                        if (!val || !val.trim()) {
                          showToast('CTA Button Error: Scroll to Section action requires choosing a target section.', 'error');
                          return;
                        }
                      } else if (action === 'open_form') {
                        if (!val || !val.trim()) {
                          showToast('CTA Button Error: Open Form action requires choosing a form.', 'error');
                          return;
                        }
                      } else if (action === 'open_calendar') {
                        if (!val || !val.trim()) {
                          showToast('CTA Button Error: Open Calendar action requires choosing a calendar connection.', 'error');
                          return;
                        }
                      } else if (action === 'email') {
                        if (!val || !val.trim()) {
                          showToast('CTA Button Error: Email action requires a recipient email address.', 'error');
                          return;
                        }
                      } else if (action === 'phone_call') {
                        if (!val || !val.trim()) {
                          showToast('CTA Button Error: Phone Call action requires a recipient phone number.', 'error');
                          return;
                        }
                      } else if (action === 'download_file') {
                        if (!val || !val.trim()) {
                          showToast('CTA Button Error: Download File action requires choosing a file.', 'error');
                          return;
                        }
                      } else if (action === 'trigger_automation') {
                        if (!val || !val.trim()) {
                          showToast('CTA Button Error: Trigger Automation action requires specifying a trigger ID or tag.', 'error');
                          return;
                        }
                      } else if (action === 'open_popup') {
                        if (!val || !val.trim()) {
                          showToast('CTA Button Error: Open Popup action requires entering popup text.', 'error');
                          return;
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    // Validate CSS syntax before saving
    if (pageLayout) {
      if (pageLayout.globalSettings?.custom_css) {
        const check = validateCssSyntax(pageLayout.globalSettings.custom_css);
        if (!check.isValid) {
          showToast(`CSS Validation Error (Global Page): ${check.error}`, 'error');
          return;
        }
      }
      if (pageLayout.sections) {
        for (const sec of pageLayout.sections) {
          if (sec.settings?.custom_css) {
            const check = validateCssSyntax(sec.settings.custom_css);
            if (!check.isValid) {
              showToast(`CSS Validation Error (Section "${sec.name}"): ${check.error}`, 'error');
              return;
            }
          }
          if (sec.rows) {
            for (const row of sec.rows) {
              if (row.columns) {
                for (const col of row.columns) {
                  if (col.components) {
                    for (const comp of col.components) {
                      let cfg: any = {};
                      try {
                        cfg = typeof comp.config === 'string' ? JSON.parse(comp.config || '{}') : (comp.config || {});
                      } catch { }
                      if (cfg.custom_css) {
                        const check = validateCssSyntax(cfg.custom_css);
                        if (!check.isValid) {
                          showToast(`CSS Validation Error (Component "${comp.type}"): ${check.error}`, 'error');
                          return;
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    setSavingStep(true);
    setAutosavePillStatus('saving');
    try {
      const payload = {
        ...editingStep,
        form_id: editingStep.form_id || null,
        page_content: JSON.stringify(pageLayout)
      };
      const updated = await funnelsApi.updateStep(selectedFunnel.id, editingStep.id, payload);
      setSteps(prev => prev.map(s => s.id === updated.id ? updated : s));
      if (!keepOpen) {
        setEditingStep(null);
      } else {
        setEditingStep(updated);
      }
      setAutosavePillStatus('saved');
      showToast('Step layout saved successfully!');
      localStorage.removeItem(`growthos_funnel_step_draft_${editingStep.id}`);
    } catch (err: any) {
      setAutosavePillStatus('unsaved');
      showToast(err.message || 'Failed to save step.', 'error');
    } finally { setSavingStep(false); }
  };

  // ─── Component Editing Helpers ─────────────────────────────────────────────
  const handleAddComponent = (type: string) => {
    let defaultConfig = {};
    switch (type) {
      case 'Heading':
        defaultConfig = { text: 'Heading Text', level: 'h1', font_size: '48px', font_weight: '700', color: '#111827', align: 'left', margin: '0 0 16px 0' };
        break;
      case 'Paragraph':
        defaultConfig = { text: 'Enter your paragraph description here...', font_size: '18px', line_height: '1.7', color: '#4b5563', align: 'left', margin: '0 0 20px 0', max_width: '700px' };
        break;
      case 'Button':
        defaultConfig = { text: 'Call to Action →', action_type: 'go_to_next_step', action_value: '', color: '#4F46E5', text_color: '#FFFFFF', style: 'primary', size: 'medium', border_radius: '8px', padding: '12px 24px', width: 'auto' };
        break;
      case 'Image':
        defaultConfig = { url: '', alt: 'Image description', width: '100%', height: 'auto', border_radius: '8px', alignment: 'center', object_fit: 'contain', loading: 'lazy' };
        break;
      case 'Video':
        defaultConfig = { url: '', provider: 'youtube', autoplay: false, controls: true, loop: false, mute: false, poster: '' };
        break;
      case 'Form':
        defaultConfig = { form_id: forms[0]?.id || '' };
        break;
      case 'Countdown':
        defaultConfig = { target_date: '2026-12-31T23:59', expired_message: 'Offer Expired!', format: 'days_hours_minutes_seconds' };
        break;
      case 'Spacer':
        defaultConfig = { height: '24px' };
        break;
      case 'Divider':
        defaultConfig = { color: '#e5e7eb', thickness: '1px', margin: '20px 0' };
        break;
      case 'Calendar':
        defaultConfig = { title: 'Book a Call', month: 'October', day: '15', time: '10:00 AM' };
        break;
      case 'Icons':
        defaultConfig = { icon_name: 'Check', size: 24, color: '#4F46E5', alignment: 'center' };
        break;
      case 'SocialLinks':
        defaultConfig = { facebook: '', twitter: '', linkedin: '', instagram: '', youtube: '', align: 'center' };
        break;
      case 'FAQ':
        defaultConfig = { items: [{ question: 'What is the refund policy?', answer: 'We offer a 30-day money-back guarantee.' }] };
        break;
      case 'Testimonials':
        defaultConfig = { items: [{ quote: 'This service is outstanding!', author: 'Jane Doe', role: 'CEO', avatar_url: '' }] };
        break;
      case 'Columns':
        defaultConfig = { layout: '50/50', col_1_components: [], col_2_components: [] };
        break;
      case 'CustomHTML':
        defaultConfig = { code: '<div style="padding: 20px; text-align: center;">Custom HTML Content</div>' };
        break;
    }
    const newComp: Partial<FunnelComponent> = {
      type,
      order: stepComponents.length,
      config: JSON.stringify(defaultConfig)
    };
    setStepComponents(prev => [...prev, newComp]);
    setEditingComponentIndex(stepComponents.length);
  };

  const handleUpdateComponentConfig = (index: number, key: string, value: any) => {
    const updated = [...stepComponents];
    const comp = updated[index];
    if (comp) {
      let cfg = {};
      try {
        cfg = JSON.parse(comp.config || '{}');
      } catch { }
      cfg = { ...cfg, [key]: value };
      comp.config = JSON.stringify(cfg);
      setStepComponents(updated);
    }
  };

  const handleRemoveComponent = (index: number) => {
    setStepComponents(prev => prev.filter((_, idx) => idx !== index));
    setEditingComponentIndex(null);
  };

  const handleMoveComponent = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= stepComponents.length) return;

    const list = [...stepComponents];
    const temp = list[index];
    list[index] = list[newIndex];
    list[newIndex] = temp;
    setStepComponents(list);
    setEditingComponentIndex(newIndex);
  };

  // ─── File Upload & Media Library ───────────────────────────────────────────
  const openMediaSelector = (callback: (url: string) => void) => {
    setOnSelectMediaCallback(() => callback);
    setIsMediaModalOpen(true);
    fetchMediaLibrary();
  };

  const triggerFileUpload = () => {
    fileInputRef.current?.click();
  };

  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      await uploadMediaFileObj(file);
    }
  };

  const handleUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await uploadMediaFileObj(file);
    }
  };

  const uploadMediaFileObj = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('http://localhost:8000/api/v1/funnels/media/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('access_token') || ''}`
        },
        body: formData
      });
      if (response.ok) {
        const asset = await response.json();
        showToast('File uploaded and added to library!');
        fetchMediaLibrary();
        if (onSelectMediaCallback) {
          onSelectMediaCallback(asset.url);
        }
        setIsMediaModalOpen(false);
      } else {
        const errorData = await response.json().catch(() => ({}));
        showToast(errorData.detail || 'Upload failed.', 'error');
      }
    } catch {
      showToast('Error uploading file.', 'error');
    }
  };

  const handleSelectAsset = (url: string) => {
    if (onSelectMediaCallback) {
      onSelectMediaCallback(url);
    }
    setIsMediaModalOpen(false);
  };

  const handleLoadAnalytics = useCallback(async () => {
    if (!selectedFunnel) return;
    try {
      const data = await funnelsApi.getAnalytics(selectedFunnel.id);
      setAnalytics(data);
    } catch { }
  }, [selectedFunnel]);

  useEffect(() => {
    if (activeTab === 'analytics' && selectedFunnel) {
      handleLoadAnalytics();
    }
  }, [activeTab, selectedFunnel, handleLoadAnalytics]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isCreateModalOpen) {
        setIsCreateModalOpen(false);
        setCreateModalStep('gallery');
        setSelectedTemplateId('blank');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCreateModalOpen]);

  const publicUrl = selectedFunnel?.published_url
    ? getFullPublishedUrl(selectedFunnel.published_url)
    : null;

  return (
    <div className={`${styles.pageContainer} ${editingStep && pageLayout ? styles.editingModeContainer : ""}`}>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {editingStep && pageLayout ? (
        <div className={styles.stepEditor}>
          {/* Autosave Recovery Banner */}
          {isAutosaveRestorable && restorableLayout && (
            <div className={styles.autosaveBanner}>
              <span>⚠️ Unsaved changes from a previous session detected.</span>
              <div className={styles.autosaveBtnRow}>
                <button className={styles.autosaveRestoreBtn} onClick={() => { setPageLayout(restorableLayout); setIsAutosaveRestorable(false); showToast('Layout recovered!'); }}>Restore</button>
                <button className={styles.autosaveDismissBtn} onClick={() => { localStorage.removeItem(`growthos_funnel_step_draft_${editingStep.id}`); setIsAutosaveRestorable(false); }}>Dismiss</button>
              </div>
            </div>
          )}

          {/* Editor Toolbar */}
          <div className={styles.builderToolbar}>
            {/* LEFT: Device viewport switcher */}
            <div className={styles.toolbarGroup}>
              <button type="button" title="Desktop view" className={`${styles.viewModeBtn} ${activeViewMode === 'desktop' ? styles.viewModeBtnActive : ''}`} onClick={() => setActiveViewMode('desktop')}>
                <Monitor size={14} /> Desktop
              </button>
              <button type="button" title="Tablet view" className={`${styles.viewModeBtn} ${activeViewMode === 'tablet' ? styles.viewModeBtnActive : ''}`} onClick={() => setActiveViewMode('tablet')}>
                <Tablet size={14} /> Tablet
              </button>
              <button type="button" title="Mobile view" className={`${styles.viewModeBtn} ${activeViewMode === 'mobile' ? styles.viewModeBtnActive : ''}`} onClick={() => setActiveViewMode('mobile')}>
                <Smartphone size={14} /> Mobile
              </button>
            </div>

            {/* CENTER: History + Layers + Section */}
            <div className={styles.toolbarGroup}>
              <button type="button" title="Undo (Ctrl+Z)" className={styles.viewModeBtn} onClick={handleUndo} disabled={historyIndex <= 0} style={{ opacity: historyIndex <= 0 ? 0.4 : 1, cursor: historyIndex <= 0 ? 'not-allowed' : 'pointer' }}>
                <Undo2 size={14} />
              </button>
              <button type="button" title="Redo (Ctrl+Shift+Z)" className={styles.viewModeBtn} onClick={handleRedo} disabled={historyIndex >= history.length - 1} style={{ opacity: historyIndex >= history.length - 1 ? 0.4 : 1, cursor: historyIndex >= history.length - 1 ? 'not-allowed' : 'pointer' }}>
                <Redo2 size={14} />
              </button>
              <div style={{ width: '1px', height: '18px', background: '#E2E8F0', margin: '0 2px' }} />
              <button type="button" title="Toggle layers" className={`${styles.viewModeBtn} ${isLayersOpen ? styles.viewModeBtnActive : ''}`} onClick={() => setIsLayersOpen(prev => !prev)}>
                <Layers size={14} />
              </button>
              <button type="button" title="Add a section" className={styles.viewModeBtn} onClick={() => setIsSectionLibraryModalOpen(true)}>
                <Plus size={14} /> Section
              </button>
              <button type="button" title="Toggle properties" className={`${styles.viewModeBtn} ${isInspectorOpen ? styles.viewModeBtnActive : ''}`} onClick={() => setIsInspectorOpen(prev => !prev)}>
                <PanelRightOpen size={14} />
              </button>
            </div>

            {/* RIGHT: Save + Autosave pill + More menu */}
            <div className={styles.toolbarGroup}>
              {/* Autosave pill */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                padding: '4px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 600,
                background: autosavePillStatus === 'saved' ? '#dcfce7' : autosavePillStatus === 'saving' ? '#fef9c3' : '#fee2e2',
                color: autosavePillStatus === 'saved' ? '#166534' : autosavePillStatus === 'saving' ? '#713f12' : '#991b1b',
                border: autosavePillStatus === 'saved' ? '1px solid #bbf7d0' : autosavePillStatus === 'saving' ? '1px solid #fde047' : '1px solid #fca5a5',
                transition: 'all 0.3s'
              }}>
                <span style={{ fontSize: '9px' }}>{autosavePillStatus === 'saved' ? '●' : autosavePillStatus === 'saving' ? '◌' : '○'}</span>
                {autosavePillStatus === 'saved' ? 'Saved' : autosavePillStatus === 'saving' ? 'Saving…' : 'Unsaved'}
              </div>
              <button
                type="button"
                title="Save current design"
                onClick={() => handleSaveStep(true)}
                disabled={savingStep}
                style={{
                  padding: '6px 14px',
                  background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '7px',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: savingStep ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  boxShadow: '0 2px 8px rgba(99,102,241,0.3)',
                  transition: 'opacity 0.2s',
                  opacity: savingStep ? 0.6 : 1,
                  whiteSpace: 'nowrap'
                }}
              >
                <Check size={13} /> Save
              </button>
              {/* More menu */}
              <div style={{ position: 'relative' }}>
                <button type="button" title="More options" className={styles.viewModeBtn} onClick={() => setShowMoreMenu(prev => !prev)}>
                  <MoreHorizontal size={14} />
                </button>
                {showMoreMenu && (
                  <>
                    <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setShowMoreMenu(false)} />
                    <div style={{
                      position: 'absolute', top: '100%', right: 0, marginTop: '6px',
                      background: '#fff', border: '1px solid #E2E8F0', borderRadius: '10px',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 100, minWidth: '180px',
                      overflow: 'hidden', animation: 'fadeIn 0.12s ease'
                    }}>
                      <a
                        href={selectedFunnel?.id && editingStep?.id ? `${window.location.origin}/funnel/${selectedFunnel.id}/${editingStep.id}?preview=true` : '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '10px 14px', background: 'none', border: 'none', fontSize: '13px', color: '#374151', cursor: 'pointer', fontWeight: 500, textAlign: 'left', textDecoration: 'none', boxSizing: 'border-box' }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#F8FAFC')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                        onClick={(e) => {
                          setShowMoreMenu(false);
                          if (!selectedFunnel?.id || !editingStep?.id) {
                            e.preventDefault();
                          }
                        }}>
                        <Eye size={14} color="#6366F1" /> Preview Page
                      </a>
                      <button type="button" style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '10px 14px', background: 'none', border: 'none', fontSize: '13px', color: '#374151', cursor: 'pointer', fontWeight: 500, textAlign: 'left' }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#F8FAFC')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                        onClick={() => {
                          const json = JSON.stringify(pageLayout, null, 2);
                          const blob = new Blob([json], { type: 'application/json' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a'); a.href = url;
                          a.download = `${editingStep?.name || 'page'}-layout.json`;
                          a.click(); URL.revokeObjectURL(url);
                          setShowMoreMenu(false);
                        }}>
                        <FileText size={14} color="#10B981" /> Export JSON
                      </button>
                      <div style={{ height: '1px', background: '#F1F5F9', margin: '2px 0' }} />
                      <button type="button" style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '10px 14px', background: 'none', border: 'none', fontSize: '13px', color: '#EF4444', cursor: 'pointer', fontWeight: 500, textAlign: 'left' }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#FEF2F2')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                        onClick={() => {
                          if (window.confirm('Reset the entire canvas? All sections and components will be cleared.')) {
                            setPageLayout((prev: any) => ({ ...prev, sections: [] }));
                            showToast('Canvas reset.', 'info');
                          }
                          setShowMoreMenu(false);
                        }}>
                        <Trash2 size={14} /> Reset Canvas
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className={styles.builderLayout}>
            {/* Left Panel: Navigator Tree */}
            <div className={`${styles.navPanel} ${isLayersOpen ? styles.navPanelOpen : styles.navPanelClosed}`}>
              <div className={styles.panelTitleRow}>
                <h4>Page Navigator</h4>
                <button type="button" className={styles.closePanelBtn} onClick={() => setIsLayersOpen(false)}>×</button>
              </div>
              <div className={styles.navTree}>
                <div className={`${styles.navNode} ${activeElement?.type === 'page' ? styles.navNodeActive : ''}`} onClick={() => setActiveElement({ type: 'page', id: 'page' })}>
                  <span className={styles.nodeLabel}><Globe size={13} /> {pageLayout.globalSettings?.seo_title || editingStep.name}</span>
                </div>
                {(pageLayout.sections || []).map((sec: any, sIdx: number) => (
                  <div key={sec.id}>
                    <div className={`${styles.navNode} ${activeElement?.id === sec.id ? styles.navNodeActive : ''}`} onClick={() => setActiveElement({ type: 'section', id: sec.id, sectionIndex: sIdx })}>
                      <span className={styles.nodeLabel}><LayoutTemplate size={12} /> {sec.name}</span>
                      <div className={styles.nodeControls}>
                        <button type="button" className={styles.nodeActionBtn} onClick={(e) => { e.stopPropagation(); moveSection(sIdx, 'up'); }} disabled={sIdx === 0}>↑</button>
                        <button type="button" className={styles.nodeActionBtn} onClick={(e) => { e.stopPropagation(); moveSection(sIdx, 'down'); }} disabled={sIdx === pageLayout.sections.length - 1}>↓</button>
                        <button type="button" className={styles.nodeActionBtn} onClick={(e) => { e.stopPropagation(); duplicateSection(sIdx); }}>Copy</button>
                        <button type="button" className={styles.nodeActionBtn} onClick={(e) => { e.stopPropagation(); deleteSection(sIdx); }}>Delete</button>
                      </div>
                    </div>
                    {/* Rows under section */}
                    {(sec.rows || []).map((row: any, rIdx: number) => (
                      <div key={row.id} style={{ paddingLeft: '12px' }}>
                        <div className={`${styles.navNode} ${activeElement?.id === row.id ? styles.navNodeActive : ''}`} style={{ color: '#10B981' }} onClick={() => setActiveElement({ type: 'row', id: row.id, sectionIndex: sIdx, rowIndex: rIdx })}>
                          <span className={styles.nodeLabel}>└─ Row {rIdx + 1}</span>
                          <div className={styles.nodeControls}>
                            <button type="button" className={styles.nodeActionBtn} onClick={(e) => { e.stopPropagation(); deleteRow(sIdx, rIdx); }}>×</button>
                          </div>
                        </div>
                        {/* Columns */}
                        {(row.columns || []).map((col: any, cIdx: number) => (
                          <div key={col.id} style={{ paddingLeft: '16px' }}>
                            <div className={styles.navNode} style={{ color: '#8B5CF6' }}>
                              <span>Col {cIdx + 1} ({col.width})</span>
                            </div>
                            {/* Components */}
                            {(col.components || []).map((comp: any, compIdx: number) => (
                              <div key={comp.id} style={{ paddingLeft: '12px' }}>
                                <div className={`${styles.navNode} ${activeElement?.id === comp.id ? styles.navNodeActive : ''}`} onClick={() => setActiveElement({ type: 'component', id: comp.id, sectionIndex: sIdx, rowIndex: rIdx, columnIndex: cIdx, index: compIdx })}>
                                  <span>{comp.type}</span>
                                  <div className={styles.nodeControls}>
                                    <button type="button" className={styles.nodeActionBtn} onClick={(e) => { e.stopPropagation(); deleteComponent(sIdx, rIdx, cIdx, compIdx); }}>×</button>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            {/* Center: Interactive Responsive Workspace Canvas */}
            <div ref={workspaceCanvasRef} className={`${styles.workspaceCanvas} funnel-page-content-wrapper`}>
              <style dangerouslySetInnerHTML={{ __html: compilePageStyles(pageLayout) }} />
              {(!pageLayout.sections || pageLayout.sections.length === 0) ? (

                <div style={{ textAlign: 'center', padding: '60px 40px', background: '#ffffff', borderRadius: '16px', border: '2px dashed #E2E8F0', margin: '40px auto', maxWidth: '600px', boxSizing: 'border-box', boxShadow: '0 10px 30px rgba(0,0,0,0.02)' }}>
                  <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎨</div>
                  <h3 style={{ fontSize: '20px', fontWeight: 700, color: '#1E293B', margin: '0 0 8px 0', fontFamily: 'Outfit, sans-serif' }}>Start building your landing page</h3>
                  <p style={{ fontSize: '14px', color: '#64748B', maxWidth: '400px', margin: '0 auto 24px auto', lineHeight: 1.6 }}>
                    You have a blank canvas! Follow these recommended steps to build a high-converting marketing funnel:
                  </p>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px', textAlign: 'left', marginBottom: '24px' }}>
                    {[
                      { step: 1, name: 'Add Navbar', detail: 'Header navigation & company branding', action: 'Navbar' },
                      { step: 2, name: 'Add Hero Section', detail: 'Primary value proposition & CTA', action: 'Hero' },
                      { step: 3, name: 'Add Features', detail: 'Showcase details & benefits', action: 'Features' },
                      { step: 4, name: 'Add Testimonials', detail: 'Social proof & client reviews', action: 'Testimonials' },
                      { step: 5, name: 'Add Form', detail: 'Capture lead details', action: 'Lead Generation' },
                      { step: 6, name: 'Add CTA', detail: 'Urgency & primary action button', action: 'CTA' },
                      { step: 7, name: 'Add Footer', detail: 'Links, copyright, & social handles', action: 'Footer' },
                    ].map((item) => (
                      <div key={item.step} style={{ padding: '12px 14px', borderRadius: '10px', background: '#F8FAFC', border: '1px solid #F1F5F9', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                        onClick={() => addSection(item.action)}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '24px', height: '24px', borderRadius: '50%', background: '#E0E7FF', color: '#4F46E5', fontSize: '11px', fontWeight: 800 }}>{item.step}</span>
                          <div>
                            <span style={{ fontWeight: 600, fontSize: '13px', color: '#1E293B', display: 'block' }}>{item.name}</span>
                            <span style={{ fontSize: '11px', color: '#64748B' }}>{item.detail}</span>
                          </div>
                        </div>
                        <span style={{ fontSize: '11px', color: '#6366F1', fontWeight: 600 }}>Click to Add +</span>
                      </div>
                    ))}
                  </div>

                  <button type="button" className={styles.createBtn} onClick={() => addSection('Blank Section')} style={{ padding: '12px 28px', fontSize: '14px', borderRadius: '10px', fontWeight: 600, margin: '0 auto' }}>
                    + Create Blank Section
                  </button>
                </div>
              ) : (
                <div style={{
                  transform: `scale(${canvasScale})`,
                  transformOrigin: 'top center',
                  flexShrink: 0,
                  transition: 'transform 0.15s ease'
                }} className={activeViewMode === 'mobile' ? styles.workspaceCanvasMobile : activeViewMode === 'tablet' ? styles.workspaceCanvasTablet : styles.workspaceCanvasDesktop}>
                  {(pageLayout.sections || []).map((sec: any, sIdx: number) => (
                    <div
                      key={sec.id}
                      className={`growthos-section sec-${sec.id} ${styles.canvasSectionNode} ${activeElement?.id === sec.id ? styles.canvasSectionNodeActive : ''}`}
                      onClick={(e) => { e.stopPropagation(); setActiveElement({ type: 'section', id: sec.id, sectionIndex: sIdx }); }}
                      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, type: 'section', sIdx }); }}
                      draggable={true}
                      onDragStart={(e) => {
                        setDraggedSectionIndex(sIdx);
                        e.dataTransfer.setData('text/plain', sIdx.toString());
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragOverSectionIndex(sIdx);
                      }}
                      onDragEnd={() => {
                        setDraggedSectionIndex(null);
                        setDragOverSectionIndex(null);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (draggedSectionIndex !== null) {
                          reorderSections(draggedSectionIndex, sIdx);
                        }
                        setDraggedSectionIndex(null);
                        setDragOverSectionIndex(null);
                      }}
                      style={getCanvasSectionStyle(sec, sIdx)}
                    >
                      {/* Background rendering inside canvas section */}
                      {sec.settings?.background_image && (
                        <div style={{
                          position: 'absolute',
                          top: 0, left: 0, right: 0, bottom: 0,
                          width: '100%', height: '100%',
                          backgroundImage: `url(${sec.settings.background_image.startsWith('/static/') ? `http://localhost:8000${sec.settings.background_image}` : sec.settings.background_image})`,
                          backgroundSize: sec.settings.background_size || 'cover',
                          backgroundRepeat: sec.settings.background_repeat || 'no-repeat',
                          backgroundAttachment: sec.settings.background_attachment || 'scroll',
                          backgroundPosition: sec.settings.background_position || 'center center',
                          filter: `blur(${sec.settings.background_blur || 0}px) brightness(${sec.settings.background_brightness !== undefined ? sec.settings.background_brightness : 1}) contrast(${sec.settings.background_contrast !== undefined ? sec.settings.background_contrast : 1})`,
                          zIndex: 0
                        }} />
                      )}

                      {sec.settings?.overlay_color && (
                        <div style={{
                          position: 'absolute',
                          top: 0, left: 0, right: 0, bottom: 0,
                          backgroundColor: sec.settings.overlay_color,
                          opacity: sec.settings.overlay_opacity !== undefined ? Number(sec.settings.overlay_opacity) : 0.5,
                          background: sec.settings.overlay_gradient || undefined,
                          zIndex: 1
                        }} />
                      )}

                      <div style={{ position: 'relative', zIndex: 2, width: '100%', height: '100%' }}>
                        <div className={styles.sectionHeaderRow}>
                          <span className={styles.secTitle}>
                            {sec.name}
                          </span>

                          <div className={styles.toolbarGroup}>
                            <button type="button" className={styles.compCopyBtn} onClick={(e) => { e.stopPropagation(); addRow(sIdx, '33/33/33'); }} title="Add Row to Section">
                              + Add Row
                            </button>
                            <button type="button" className={styles.compCopyBtn} onClick={(e) => { e.stopPropagation(); duplicateSection(sIdx); }} title="Duplicate section">
                              <Copy size={11} /> Copy
                            </button>
                            <button type="button" className={styles.compDeleteBtn} onClick={(e) => { e.stopPropagation(); deleteSection(sIdx); }} title="Delete section">
                              <Trash2 size={11} /> Delete
                            </button>
                          </div>
                        </div>

                        {sec.type === 'Navbar' ? (() => {
                          const logoAlign = sec.settings?.logo_align || 'left';
                          const isMobile = activeViewMode === 'mobile';
                          return (
                            <div
                              data-section-type={(sec.type || '').toLowerCase()}
                              data-section-name={(sec.name || '').toLowerCase()}
                              data-anchor={(sec.settings?.anchor_id || '').toLowerCase()}
                              style={{
                                position: 'relative',
                                top: 0,
                                zIndex: 100,
                                display: 'flex',
                                flexDirection: (!isMobile && logoAlign === 'center') ? 'column' : (logoAlign === 'right' ? 'row-reverse' : 'row'),
                                gap: (!isMobile && logoAlign === 'center') ? '12px' : '20px',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                width: '100%',
                                background: sec.settings?.transparent ? 'transparent' : (sec.settings?.background_color || '#ffffff'),
                                borderBottom: sec.settings?.show_divider ? '1px solid #e2e8f0' : 'none',
                                boxShadow: sec.settings?.shadow === 'none' ? 'none' : sec.settings?.shadow === 'medium' ? '0 4px 6px -1px rgba(0,0,0,0.05)' : sec.settings?.shadow === 'dark' ? '0 10px 15px -3px rgba(0,0,0,0.05)' : '0 1px 3px rgba(0,0,0,0.05)',
                                boxSizing: 'border-box',
                                borderRadius: '6px',
                                padding: sec.settings?.padding || '12px 16px'
                              }}
                            >
                              <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                justifyContent: (!isMobile && logoAlign === 'center') ? 'center' : 'flex-start',
                                width: (!isMobile && logoAlign === 'center') ? '100%' : 'auto'
                              }}>
                                {sec.settings?.logo_url && (
                                  <img
                                    src={resolveAssetUrl(sec.settings.logo_url)}
                                    style={{
                                      height: sec.settings?.logo_height ? `${sec.settings.logo_height}px` : '28px',
                                      width: sec.settings?.logo_width ? `${sec.settings.logo_width}px` : 'auto',
                                      objectFit: (sec.settings?.logo_object_fit as any) || 'contain',
                                      borderRadius: sec.settings?.logo_border_radius ? `${sec.settings.logo_border_radius}px` : '0px'
                                    }}
                                    alt="Logo"
                                  />
                                )}
                                <span style={{
                                  fontFamily: sec.settings?.company_font_family || sec.settings?.logo_font_family || 'inherit',
                                  fontSize: sec.settings?.company_font_size ? `${sec.settings.company_font_size}px` : (sec.settings?.logo_font_size || '16px'),
                                  fontWeight: sec.settings?.company_font_weight || sec.settings?.logo_font_weight || 800,
                                  color: sec.settings?.company_font_color || sec.settings?.logo_font_color || '#1e293b',
                                  fontStyle: sec.settings?.company_font_style || 'normal',
                                  letterSpacing: sec.settings?.company_letter_spacing !== undefined ? `${sec.settings.company_letter_spacing}px` : (sec.settings?.logo_letter_spacing || '-0.3px'),
                                  textTransform: (sec.settings?.company_text_transform as any) || 'none'
                                }}>
                                  {sec.settings?.company_name || sec.settings?.logo_text || '🚀 GrowthOS'}
                                </span>
                              </div>

                              {isMobile ? (
                                <div style={{ border: '1px solid #e2e8f0', borderRadius: '4px', padding: '4px 8px', fontSize: '12px', fontWeight: 600, color: '#64748b', background: '#f8fafc' }}>
                                  Menu ☰
                                </div>
                              ) : (
                                <div style={{
                                  display: 'flex',
                                  gap: '20px',
                                  alignItems: 'center',
                                  justifyContent: logoAlign === 'center' ? 'center' : (logoAlign === 'right' ? 'flex-start' : 'flex-end'),
                                  flexDirection: logoAlign === 'right' ? 'row-reverse' : 'row',
                                  width: logoAlign === 'center' ? '100%' : 'auto'
                                }}>
                                  <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                                    {(sec.settings?.links || []).map((l: any, idx: number) => (
                                      <span
                                        key={idx}
                                        title={l.url ? `Click to test link (${l.url})` : undefined}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const rawUrl = (l.url || '').trim();
                                          if (rawUrl) {
                                            const targetId = rawUrl.replace(/^#/, '').toLowerCase().trim();
                                            const elements = Array.from(document.querySelectorAll('section, [id], [data-anchor]'));
                                            let foundEl: HTMLElement | null = null;
                                            for (const el of elements) {
                                              const elId = (el.getAttribute('id') || '').toLowerCase().trim();
                                              const elAnchor = (el.getAttribute('data-anchor') || '').toLowerCase().trim();
                                              const elName = (el.getAttribute('data-section-name') || '').toLowerCase().trim();
                                              const elType = (el.getAttribute('data-section-type') || '').toLowerCase().trim();

                                              if (
                                                elId === targetId ||
                                                elAnchor === targetId ||
                                                elType === targetId ||
                                                elName === targetId ||
                                                elName === `${targetId} section` ||
                                                elName.replace(/\s+section$/, '') === targetId
                                              ) {
                                                foundEl = el as HTMLElement;
                                                break;
                                              }
                                            }
                                            if (foundEl) {
                                              foundEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                            }
                                          }
                                        }}
                                        style={{
                                          fontSize: sec.settings?.nav_font_size ? `${sec.settings.nav_font_size}px` : '13px',
                                          fontWeight: sec.settings?.nav_font_weight || 600,
                                          color: l.color || sec.settings?.nav_hover_color || sec.settings?.nav_color || '#475569',
                                          fontStyle: l.font_style || sec.settings?.nav_font_style || 'normal',
                                          fontFamily: sec.settings?.nav_font_family || 'inherit',
                                          cursor: l.url ? 'pointer' : 'inherit'
                                        }}
                                      >
                                        {l.label}
                                      </span>
                                    ))}
                                  </div>

                                  {sec.settings?.cta_text && (
                                    <button type="button" style={{
                                      padding: '6px 14px',
                                      backgroundColor: sec.settings?.cta_bg_color || (sec.settings?.cta_style === 'outline' ? 'transparent' : '#4F46E5'),
                                      color: sec.settings?.cta_text_color || '#ffffff',
                                      border: sec.settings?.cta_border || (sec.settings?.cta_style === 'outline' ? `1.5px solid ${sec.settings?.cta_bg_color || '#4F46E5'}` : 'none'),
                                      borderRadius: '6px',
                                      fontSize: '11px',
                                      fontWeight: 700
                                    }}>
                                      {sec.settings?.cta_text}
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })() : sec.type === 'Footer' ? (
                          <div
                            style={{
                              padding: sec.settings?.padding || '30px 20px',
                              width: '100%',
                              background: sec.settings?.background_color || '#1e293b',
                              boxSizing: 'border-box'
                            }}
                            className={`sec-${sec.id}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveElement({ type: 'section', id: sec.id, sectionIndex: sIdx });
                            }}
                          >
                            <FooterRenderer
                              section={sec}
                              isMobileDevice={activeViewMode === 'mobile'}
                              onUpdateSectionSettings={(key, val) => {
                                const nextSections = JSON.parse(JSON.stringify(pageLayout.sections));
                                if (nextSections[sIdx]) {
                                  nextSections[sIdx].settings = nextSections[sIdx].settings || {};
                                  nextSections[sIdx].settings[key] = val;
                                  updateLayoutState({ ...pageLayout, sections: nextSections });
                                }
                              }}
                              onOpenMediaSelector={openMediaSelector}
                            />
                          </div>
                        ) : (
                          <>
                            {/* Rows */}
                            {(sec.rows || []).map((row: any, rIdx: number) => (
                              <div key={row.id} className={`${styles.canvasRowNode} row-${row.id} ${activeElement?.id === row.id ? styles.canvasRowNodeActive : ''}`} onClick={(e) => { e.stopPropagation(); setActiveElement({ type: 'row', id: row.id, sectionIndex: sIdx, rowIndex: rIdx }); }} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, type: 'row', sIdx, rIdx }); }}>
                                <div className={styles.rowHeaderRow}>
                                  <span className={styles.rowTitle}>Row {rIdx + 1} ({(row.columns || []).length} Cols)</span>
                                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                    <button type="button" className={styles.nodeActionBtn} onClick={(e) => { e.stopPropagation(); addColumnToRow(sIdx, rIdx); }}>+ Add Column</button>
                                    <button type="button" className={styles.nodeActionBtn} onClick={(e) => { e.stopPropagation(); deleteRow(sIdx, rIdx); }} style={{ color: '#ef4444' }}>Delete Row</button>
                                  </div>
                                </div>

                                {/* Columns list */}
                                <div className={styles.columnsFlexRow} style={{ display: 'flex', flexDirection: activeViewMode === 'mobile' ? 'column' : 'row', gap: row.settings?.gap || '12px', alignItems: row.settings?.align_items || 'stretch', justifyContent: row.settings?.justify_content || 'flex-start', flexWrap: 'wrap', width: '100%', boxSizing: 'border-box' }}>
                                  {(row.columns || []).map((col: any, cIdx: number) => (
                                    <div key={col.id} style={getColumnWidthStyle(col.width, cIdx, activeViewMode)} className={`${styles.canvasColumnNode} col-${col.id} ${activeElement?.id === col.id ? styles.canvasColumnNodeActive : ""}`} onClick={(e) => { e.stopPropagation(); setActiveElement({ type: "column", id: col.id, sectionIndex: sIdx, rowIndex: rIdx, columnIndex: cIdx }); }}>
                                      <div className={styles.columnHeaderRow}>
                                        <span className={styles.columnTitle}>{col.width || '1/3'} Col</span>
                                        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                                          <button type="button" className={styles.nodeActionBtn} onClick={(e) => { e.stopPropagation(); duplicateColumn(sIdx, rIdx, cIdx); }} title="Duplicate Column">Copy</button>
                                          {(row.columns || []).length > 1 && (
                                            <button type="button" className={styles.nodeActionBtn} onClick={(e) => { e.stopPropagation(); deleteColumn(sIdx, rIdx, cIdx); }} style={{ color: '#ef4444' }} title="Delete Column">✕</button>
                                          )}
                                        </div>
                                      </div>

                                      {(!col.components || col.components.length === 0) && (
                                        <div style={{ padding: '24px 16px', border: '1.5px dashed #cbd5e1', borderRadius: '8px', background: '#f8fafc', color: '#94a3b8', fontSize: '12px', textAlign: 'center', marginBottom: '8px' }}>
                                          Drag components here or add one below
                                        </div>
                                      )}
                                      {/* Components inside Column */}
                                      {(col.components || []).map((comp: any, compIdx: number) => {
                                        const isCompActive = activeElement?.id === comp.id;
                                        let cfg: any = {};
                                        try {
                                          cfg = typeof comp.config === 'string' ? JSON.parse(comp.config || '{}') : (comp.config || {});
                                        } catch { }

                                        const hasValError = (() => {
                                          if (comp.type === 'Heading' || comp.type === 'Paragraph') {
                                            return !cfg.text || !cfg.text.trim();
                                          }
                                          if (comp.type === 'Button') {
                                            if (!cfg.text || !cfg.text.trim()) return true;
                                            const action = cfg.action_type || 'go_to_next_step';
                                            if (['go_to_specific_step', 'open_external_url', 'download_file', 'phone_call', 'email', 'scroll_to_section', 'trigger_automation'].includes(action)) {
                                              return !cfg.action_value || !cfg.action_value.trim();
                                            }
                                            return false;
                                          }
                                          if (comp.type === 'Form') {
                                            return !cfg.form_id;
                                          }
                                          if (comp.type === 'Image' || comp.type === 'Video') {
                                            return !cfg.url;
                                          }
                                          if (comp.type === 'Calendar') {
                                            return !cfg.slot1_month || !cfg.slot1_day || !cfg.slot1_time;
                                          }
                                          return false;
                                        })();

                                        return (
                                          <div
                                            key={comp.id}
                                            className={`${styles.canvasComponentNode} comp-${comp.id} ${isCompActive ? styles.canvasComponentNodeActive : ''}`}
                                            onClick={(e) => { e.stopPropagation(); setActiveElement({ type: 'component', id: comp.id, sectionIndex: sIdx, rowIndex: rIdx, columnIndex: cIdx, index: compIdx }); }}
                                            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, type: 'component', sIdx, rIdx, cIdx, index: compIdx }); }}
                                            draggable={true}
                                            onDragStart={(e) => {
                                              e.dataTransfer.setData('application/json', JSON.stringify({ sIdx, rIdx, cIdx, compIdx }));
                                            }}
                                            onDragOver={(e) => e.preventDefault()}
                                            onDrop={(e) => {
                                              e.preventDefault();
                                              try {
                                                const data = JSON.parse(e.dataTransfer.getData('application/json'));
                                                if (data && typeof data === 'object') {
                                                  moveComponent(data.sIdx, data.rIdx, data.cIdx, data.compIdx, sIdx, rIdx, cIdx, compIdx);
                                                }
                                              } catch { }
                                            }}
                                          >
                                            <div className={styles.componentHeaderRow}>
                                              <span className={styles.componentTitle}>
                                                {comp.type}
                                              </span>
                                              {hasValError && (
                                                <span className={styles.errorIndicatorPill}>Missing Config</span>
                                              )}
                                              <div className={styles.compToolbar}>
                                                <button type="button" onClick={(e) => { e.stopPropagation(); duplicateComponent(sIdx, rIdx, cIdx, compIdx); }}>Copy</button>
                                                <button type="button" onClick={(e) => { e.stopPropagation(); deleteComponent(sIdx, rIdx, cIdx, compIdx); }} style={{ color: '#ef4444' }}>Delete</button>
                                              </div>
                                            </div>
                                            <div className={styles.componentPreviewArea} style={{ width: '100%' }}>
                                              {comp.type === 'Heading' && (() => {
                                                const Tag = (cfg.level || 'h2') as any;
                                                const level = cfg.level || 'h2';
                                                const defaultSize = level === 'h1' ? '48px' : level === 'h2' ? '36px' : level === 'h3' ? '24px' : '20px';
                                                const defaultWeight = level === 'h1' || level === 'h2' ? '700' : '600';
                                                return (
                                                  <Tag style={{
                                                    margin: 0,
                                                    padding: 0,
                                                    fontFamily: cfg.font_family || 'inherit',
                                                    fontSize: cfg.font_size || defaultSize,
                                                    fontWeight: cfg.font_weight || defaultWeight,
                                                    color: cfg.color || '#111827',
                                                    textAlign: (cfg.alignment || cfg.align || 'left') as any,
                                                    lineHeight: cfg.line_height || '1.2',
                                                    letterSpacing: cfg.letter_spacing || 'normal',
                                                    textTransform: (cfg.text_transform as any) || 'none',
                                                    maxWidth: cfg.max_width || '100%'
                                                  }}>
                                                    {cfg.text || 'Heading Text'}
                                                  </Tag>
                                                );
                                              })()}
                                              {comp.type === 'Paragraph' && (
                                                <p style={{
                                                  margin: 0,
                                                  padding: 0,
                                                  fontFamily: cfg.font_family || 'inherit',
                                                  fontSize: (activeViewMode === 'mobile' && cfg.mobile_font_size) ? cfg.mobile_font_size : (cfg.font_size || '15px'),
                                                  fontWeight: cfg.font_weight || 400,
                                                  color: cfg.color || '#4B5563',
                                                  textAlign: (cfg.alignment || cfg.align || 'left') as any,
                                                  lineHeight: cfg.line_height || '1.6',
                                                  letterSpacing: cfg.letter_spacing || 'normal',
                                                  textTransform: (cfg.text_transform as any) || 'none',
                                                  whiteSpace: 'pre-wrap',
                                                  maxWidth: cfg.max_width || '100%'
                                                }}>
                                                  {cfg.text || 'Enter your paragraph description here...'}
                                                </p>
                                              )}
                                              {comp.type === 'Button' && (() => {
                                                const isOutline = cfg.style === 'outline';
                                                const isFlat = cfg.style === 'flat';
                                                const align = cfg.alignment || 'center';
                                                const width = cfg.full_width ? '100%' : 'auto';
                                                return (
                                                  <div style={{ display: 'flex', justifyContent: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center', width: '100%' }}>
                                                    <button type="button" style={{
                                                      padding: cfg.size === 'small' ? '6px 12px' : cfg.size === 'large' ? '12px 24px' : '9px 18px',
                                                      backgroundColor: isOutline || isFlat ? 'transparent' : (cfg.color || '#4F46E5'),
                                                      color: isOutline || isFlat ? (cfg.color || '#4F46E5') : (cfg.text_color || '#ffffff'),
                                                      border: isOutline ? `1.5px solid ${cfg.color || '#4F46E5'}` : 'none',
                                                      borderRadius: cfg.border_radius || '8px',
                                                      fontWeight: 600,
                                                      fontSize: cfg.size === 'small' ? '12px' : cfg.size === 'large' ? '15px' : '13px',
                                                      textDecoration: isFlat ? 'underline' : 'none',
                                                      width
                                                    }}>
                                                      {cfg.text || 'Button'}
                                                    </button>
                                                  </div>
                                                );
                                              })()}
                                              {comp.type === 'Image' && (
                                                <div style={{ display: 'flex', justifyContent: cfg.align === 'left' ? 'flex-start' : cfg.align === 'right' ? 'flex-end' : 'center', width: '100%' }}>
                                                  {cfg.url ? (
                                                    <img
                                                      src={resolveAssetUrl(cfg.url)}
                                                      style={{
                                                        maxWidth: cfg.width || '100%',
                                                        width: cfg.width || 'auto',
                                                        height: cfg.height || 'auto',
                                                        borderRadius: cfg.border_radius || '8px',
                                                        border: '1px solid #e2e8f0',
                                                        objectFit: (cfg.object_fit as any) || 'contain',
                                                        cursor: 'pointer'
                                                      }}
                                                      alt={cfg.alt || 'Funnel Image'}
                                                      title="Click to select or change image"
                                                      onClick={(e) => {
                                                        if (openMediaSelector) {
                                                          e.stopPropagation();
                                                          openMediaSelector((url) => {
                                                            const nextSections = JSON.parse(JSON.stringify(pageLayout.sections));
                                                            const currentCfg = JSON.parse(nextSections[sIdx].rows[rIdx].columns[cIdx].components[compIdx].config || '{}');
                                                            currentCfg.url = url;
                                                            nextSections[sIdx].rows[rIdx].columns[cIdx].components[compIdx].config = JSON.stringify(currentCfg);
                                                            updateLayoutState({ ...pageLayout, sections: nextSections });
                                                          });
                                                        }
                                                      }}
                                                    />
                                                  ) : (
                                                    <div
                                                      title="Click to select or upload image"
                                                      onClick={(e) => {
                                                        if (openMediaSelector) {
                                                          e.stopPropagation();
                                                          openMediaSelector((url) => {
                                                            const nextSections = JSON.parse(JSON.stringify(pageLayout.sections));
                                                            const currentCfg = JSON.parse(nextSections[sIdx].rows[rIdx].columns[cIdx].components[compIdx].config || '{}');
                                                            currentCfg.url = url;
                                                            nextSections[sIdx].rows[rIdx].columns[cIdx].components[compIdx].config = JSON.stringify(currentCfg);
                                                            updateLayoutState({ ...pageLayout, sections: nextSections });
                                                          });
                                                        }
                                                      }}
                                                      style={{
                                                        width: cfg.width || '100%',
                                                        maxWidth: '360px',
                                                        height: '140px',
                                                        borderRadius: cfg.border_radius || '10px',
                                                        border: '2px dashed #cbd5e1',
                                                        background: '#f8fafc',
                                                        display: 'flex',
                                                        flexDirection: 'column',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        gap: '6px',
                                                        color: '#64748b',
                                                        cursor: 'pointer',
                                                        transition: 'all 0.15s ease'
                                                      }}
                                                    >
                                                      <span style={{ fontSize: '26px' }}>🖼️</span>
                                                      <span style={{ fontSize: '12px', fontWeight: 600 }}>Click to select or upload image</span>
                                                    </div>
                                                  )}
                                                </div>
                                              )}
                                              {comp.type === 'Video' && (() => {
                                                const videoUrl = cfg.url || (cfg.youtube_id ? `https://www.youtube.com/watch?v=${cfg.youtube_id}` : '');
                                                const parsed = parseVideoUrl(videoUrl);
                                                const ratioStr = cfg.ratio || '16:9';
                                                return (
                                                  <div style={{ width: '100%', position: 'relative', aspectRatio: ratioStr.replace(':', '/'), borderRadius: '12px', overflow: 'hidden', background: '#000', boxShadow: '0 4px 20px rgba(0,0,0,0.12)' }}>
                                                    {parsed.provider === 'youtube' && (
                                                      <iframe
                                                        src={`https://www.youtube.com/embed/${parsed.id}?autoplay=${cfg.autoplay ? 1 : 0}&mute=${cfg.autoplay ? 1 : 0}&controls=${cfg.controls !== false ? 1 : 0}`}
                                                        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
                                                        allow="autoplay; encrypted-media"
                                                        allowFullScreen
                                                      />
                                                    )}
                                                    {parsed.provider === 'vimeo' && (
                                                      <iframe
                                                        src={`https://player.vimeo.com/video/${parsed.id}?autoplay=${cfg.autoplay ? 1 : 0}&muted=${cfg.autoplay ? 1 : 0}`}
                                                        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
                                                        allow="autoplay; fullscreen"
                                                        allowFullScreen
                                                      />
                                                    )}
                                                    {parsed.provider === 'html5' && (
                                                      <video
                                                        src={parsed.id.startsWith('/static/') ? `http://localhost:8000${parsed.id}` : parsed.id}
                                                        autoPlay={cfg.autoplay}
                                                        muted={cfg.autoplay}
                                                        controls={cfg.controls !== false}
                                                        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                                                      />
                                                    )}
                                                    {(parsed.provider === 'unknown' || parsed.provider === 'none') && (
                                                      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: '13px', gap: '6px' }}>
                                                        <span style={{ fontSize: '28px' }}>🎥</span>
                                                        <span style={{ fontWeight: 600 }}>Video Player ({ratioStr})</span>
                                                        <span style={{ fontSize: '11px' }}>{videoUrl ? 'Unsupported format — try a YouTube or MP4 URL' : 'Paste a YouTube, Vimeo, or MP4 URL above'}</span>
                                                      </div>
                                                    )}
                                                  </div>
                                                );
                                              })()}
                                              {comp.type === 'Form' && (() => {
                                                const formObj = forms.find(f => f.id === cfg.form_id);
                                                const dynamicFields = cfg.form_id && formFieldsMap[cfg.form_id] ? formFieldsMap[cfg.form_id] : [];
                                                const formBg = cfg.form_bg_color || '#F8FAFC';
                                                const formBorder = cfg.form_border_color || '#E2E8F0';
                                                const labelColor = cfg.label_color || '#1E293B';
                                                const labelFontSize = cfg.label_font_size || '12px';
                                                const labelFontWeight = cfg.label_font_weight || '600';
                                                const inputBg = cfg.input_bg_color || '#ffffff';
                                                const inputTextColor = cfg.input_text_color || '#111827';
                                                const inputBorderColor = cfg.input_border_color || '#CBD5E1';
                                                const inputBorderRadius = cfg.input_border_radius || '8px';
                                                const btnBg = cfg.button_bg_color || '#4F46E5';
                                                const btnTextColor = cfg.button_text_color || '#ffffff';
                                                const btnFontSize = cfg.button_font_size || '14px';
                                                const btnFontWeight = cfg.button_font_weight || '700';
                                                const btnBorderRadius = cfg.button_border_radius || '8px';
                                                const shadowStyle = cfg.form_shadow === 'modern' ? '0 10px 25px -5px rgba(0,0,0,0.08)' : cfg.form_shadow === 'elevation' ? '0 20px 30px -10px rgba(0,0,0,0.15)' : 'none';

                                                return (
                                                  <div style={{
                                                    border: `1.5px solid ${formBorder}`,
                                                    borderRadius: cfg.form_border_radius || '16px',
                                                    padding: cfg.form_padding || '20px',
                                                    background: formBg,
                                                    boxShadow: shadowStyle,
                                                    width: '100%',
                                                    boxSizing: 'border-box',
                                                    transition: 'all 0.2s ease'
                                                  }}>
                                                    <div style={{ fontWeight: 700, fontSize: '13px', color: labelColor, marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                      <span>📋</span> <span>CRM Lead Form: {formObj ? formObj.title : 'No Form Selected'}</span>
                                                    </div>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%', boxSizing: 'border-box' }}>
                                                      {dynamicFields.length > 0 ? (
                                                        dynamicFields.map(f => (
                                                          <div key={f.id}>
                                                            <label style={{ display: 'block', fontSize: labelFontSize, fontWeight: labelFontWeight as any, color: labelColor, marginBottom: '4px' }}>
                                                              {f.label || f.name}{f.is_required && <span style={{ color: '#EF4444' }}> *</span>}
                                                            </label>
                                                            {f.field_type === 'textarea' ? (
                                                              <textarea disabled placeholder={f.label || f.name} style={{ padding: '10px 12px', fontSize: '13px', color: inputTextColor, background: inputBg, border: `1.5px solid ${inputBorderColor}`, borderRadius: inputBorderRadius, width: '100%', boxSizing: 'border-box', minHeight: '70px', resize: 'vertical' }} />
                                                            ) : (
                                                              <input disabled placeholder={f.label || f.name} style={{ padding: '10px 12px', fontSize: '13px', color: inputTextColor, background: inputBg, border: `1.5px solid ${inputBorderColor}`, borderRadius: inputBorderRadius, width: '100%', boxSizing: 'border-box' }} />
                                                            )}
                                                          </div>
                                                        ))
                                                      ) : (
                                                        <></>
                                                      )}
                                                      <button type="button" style={{ padding: '12px 16px', background: btnBg, color: btnTextColor, border: 'none', borderRadius: btnBorderRadius, fontSize: btnFontSize, fontWeight: btnFontWeight as any, width: '100%', cursor: 'pointer', transition: 'all 0.2s ease', marginTop: '4px', boxShadow: '0 4px 12px rgba(79, 70, 229, 0.18)' }}>
                                                        {cfg.submit_text || 'Submit Form'}
                                                      </button>
                                                    </div>
                                                  </div>
                                                );
                                              })()}
                                              {comp.type === 'Calendar' && (
                                                <GoogleCalendarWidget config={cfg} isPreview={true} />
                                              )}
                                              {comp.type === 'Countdown' && (() => {
                                                const { align, containerFlexJustify, boxPadding, digitFontSize, labelFontSize, gapSize, maxWidthVal } = getCountdownStyles(cfg, activeViewMode === 'mobile');
                                                const bgColor = cfg.bg_color || cfg.background_color || cfg.background || '#F3F4F6';
                                                const textColor = cfg.text_color || '#111827';
                                                const borderRadius = cfg.border_radius || '16px';

                                                return (
                                                  <div style={{ width: '100%', display: 'flex', justifyContent: containerFlexJustify }}>
                                                    <div style={{
                                                      width: '100%',
                                                      maxWidth: maxWidthVal,
                                                      background: bgColor,
                                                      color: textColor,
                                                      borderRadius,
                                                      padding: boxPadding,
                                                      textAlign: align as any,
                                                      boxSizing: 'border-box'
                                                    }}>
                                                      {cfg.label && <p style={{ fontSize: '13px', color: textColor, opacity: 0.8, marginBottom: '8px', fontWeight: 600, margin: '0 0 8px 0' }}>{cfg.label}</p>}
                                                      <div style={{ display: 'flex', gap: gapSize, justifyContent: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center', alignItems: 'center', fontWeight: 800 }}>
                                                        <div style={{ textAlign: 'center' }}>
                                                          <div style={{ fontSize: digitFontSize, lineHeight: 1.1 }}>01</div>
                                                          <div style={{ fontSize: labelFontSize, fontWeight: 600, opacity: 0.7, textTransform: 'uppercase', marginTop: '2px' }}>DAYS</div>
                                                        </div>
                                                        <div style={{ fontSize: digitFontSize, opacity: 0.4, lineHeight: 1.1 }}>:</div>
                                                        <div style={{ textAlign: 'center' }}>
                                                          <div style={{ fontSize: digitFontSize, lineHeight: 1.1 }}>14</div>
                                                          <div style={{ fontSize: labelFontSize, fontWeight: 600, opacity: 0.7, textTransform: 'uppercase', marginTop: '2px' }}>HOURS</div>
                                                        </div>
                                                        <div style={{ fontSize: digitFontSize, opacity: 0.4, lineHeight: 1.1 }}>:</div>
                                                        <div style={{ textAlign: 'center' }}>
                                                          <div style={{ fontSize: digitFontSize, lineHeight: 1.1 }}>36</div>
                                                          <div style={{ fontSize: labelFontSize, fontWeight: 600, opacity: 0.7, textTransform: 'uppercase', marginTop: '2px' }}>MINS</div>
                                                        </div>
                                                        <div style={{ fontSize: digitFontSize, opacity: 0.4, lineHeight: 1.1 }}>:</div>
                                                        <div style={{ textAlign: 'center' }}>
                                                          <div style={{ fontSize: digitFontSize, lineHeight: 1.1 }}>55</div>
                                                          <div style={{ fontSize: labelFontSize, fontWeight: 600, opacity: 0.7, textTransform: 'uppercase', marginTop: '2px' }}>SECS</div>
                                                        </div>
                                                      </div>
                                                    </div>
                                                  </div>
                                                );
                                              })()}
                                              {comp.type === 'Spacer' && (() => {
                                                const rawH = String(cfg.height ?? '24px').trim();
                                                const cleanH = rawH.endsWith('pxpx') ? rawH.replace('pxpx', 'px') : (rawH.endsWith('px') ? rawH : (/^\d+$/.test(rawH) ? `${rawH}px` : rawH || '24px'));
                                                return (
                                                  <div style={{ height: cleanH, minHeight: cleanH, width: '100%', flexShrink: 0, border: '1px dashed #cbd5e1', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', color: '#94a3b8', boxSizing: 'border-box' }}>
                                                    Spacer ({cleanH})
                                                  </div>
                                                );
                                              })()}
                                              {comp.type === 'Divider' && (() => {
                                                const rawThick = String(cfg.thickness ?? '1px').trim();
                                                const cleanThick = rawThick.endsWith('pxpx') ? rawThick.replace('pxpx', 'px') : (rawThick.endsWith('px') ? rawThick : (/^\d+$/.test(rawThick) ? `${rawThick}px` : rawThick || '1px'));
                                                return (
                                                  <div style={{ margin: cfg.margin || '12px 0', width: '100%' }}>
                                                    <hr style={{ border: 'none', borderTop: `${cleanThick} solid ${cfg.color || '#e5e7eb'}`, margin: 0, width: '100%' }} />
                                                  </div>
                                                );
                                              })()}
                                              {comp.type === 'CustomHTML' && (
                                                <div style={{ background: '#f8fafc', border: '1px dashed #cbd5e1', padding: '14px', borderRadius: '6px', fontSize: '10px', color: '#64748b', fontFamily: 'monospace' }}>
                                                  📝 Custom HTML Embed Code Block: {cfg.code ? (cfg.code.slice(0, 45) + '...') : 'No HTML loaded'}
                                                </div>
                                              )}
                                              {comp.type === 'SocialLinks' && renderSocialLinksComponent(cfg)}
                                              {comp.type === 'FAQ' && (
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%' }}>
                                                  {(cfg.items || []).map((faq: any, fIdx: number) => (
                                                    <div key={fIdx} style={{ border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px', background: '#F8FAFC', textAlign: 'left' }}>
                                                      <div style={{ fontWeight: 700, fontSize: '12px', color: '#1E293B' }}>Q: {faq.question}</div>
                                                      <div style={{ fontSize: '11px', color: '#4B5563', marginTop: '4px' }}>A: {faq.answer}</div>
                                                    </div>
                                                  ))}
                                                </div>
                                              )}
                                              {comp.type === 'Testimonials' && (() => {
                                                const items = cfg.items || cfg.testimonials || [];
                                                return (
                                                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px', width: '100%' }}>
                                                    {items.map((test: any, tIdx: number) => {
                                                      const name = test.author || test.name || 'Customer';
                                                      const company = test.company || test.role || test.designation || '';
                                                      const quote = test.quote || test.content || '';
                                                      const rating = test.rating || 5;
                                                      return (
                                                        <div key={tIdx} style={{ border: '1px solid #e2e8f0', borderRadius: '12px', padding: '12px', background: '#F8FAFC', textAlign: 'left' }}>
                                                          <div style={{ display: 'flex', gap: '2px', color: '#F59E0B', fontSize: '12px', marginBottom: '6px' }}>
                                                            {'★'.repeat(Math.min(5, Math.max(1, rating)))}{'☆'.repeat(5 - Math.min(5, Math.max(1, rating)))}
                                                          </div>
                                                          <div style={{ fontStyle: 'italic', fontSize: '11px', color: '#334155', lineHeight: 1.5, marginBottom: '8px' }}>"{quote}"</div>
                                                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                            <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#6366F1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: '11px', flexShrink: 0 }}>
                                                              {(name || '?')[0]}
                                                            </div>
                                                            <div>
                                                              <div style={{ fontWeight: 700, fontSize: '11px', color: '#1E293B' }}>{name}</div>
                                                              {company && <div style={{ fontSize: '10px', color: '#64748B' }}>{company}</div>}
                                                            </div>
                                                          </div>
                                                        </div>
                                                      );
                                                    })}
                                                  </div>
                                                );
                                              })()}
                                              {comp.type === 'Icons' && (() => {
                                                const align = cfg.alignment || cfg.align || 'center';
                                                const flexJustify = align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';
                                                return (
                                                  <div style={{ display: 'flex', justifyContent: flexJustify, width: '100%' }}>
                                                    {renderSvgIcon(cfg.icon_name || 'Check', cfg.size || 24, cfg.color || '#4F46E5')}
                                                  </div>
                                                );
                                              })()}
                                            </div>
                                          </div>
                                        );
                                      })}

                                      {/* Add Component drop selector */}
                                      <div style={{ position: 'relative' }}>
                                        <button type="button" className={styles.addBlockBtn} style={{ width: '100%', padding: '8px', cursor: 'pointer' }} onClick={(e) => {
                                          e.stopPropagation();
                                          setActiveSearchCol({ sIdx, rIdx, cIdx });
                                          setCompSearchTerm('');
                                        }}>
                                          + Add Component
                                        </button>
                                        {activeSearchCol?.sIdx === sIdx && activeSearchCol?.rIdx === rIdx && activeSearchCol?.cIdx === cIdx && (
                                          <div style={{
                                            position: 'absolute',
                                            bottom: '100%',
                                            left: 0,
                                            width: '250px',
                                            background: '#ffffff',
                                            border: '1.5px solid #E2E8F0',
                                            borderRadius: '12px',
                                            boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
                                            padding: '12px',
                                            zIndex: 1000,
                                            textAlign: 'left'
                                          }} onClick={e => e.stopPropagation()}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                              <span style={{ fontWeight: 700, fontSize: '12px', color: '#1e293b' }}>Add Component</span>
                                              <button type="button" style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '14px', color: '#94a3b8' }} onClick={() => setActiveSearchCol(null)}>×</button>
                                            </div>
                                            <input
                                              placeholder="Search component..."
                                              value={compSearchTerm}
                                              onChange={e => setCompSearchTerm(e.target.value)}
                                              style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '11px', boxSizing: 'border-box', marginBottom: '8px' }}
                                            />

                                            <div style={{ maxHeight: '180px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '4px' }}>
                                              {['Heading', 'Paragraph', 'Button', 'Image', 'Video', 'Form', 'Calendar', 'Countdown', 'Spacer', 'Divider', 'Icons', 'SocialLinks', 'FAQ', 'Testimonials', 'CustomHTML']
                                                .filter(c => c.toLowerCase().includes(compSearchTerm.toLowerCase()))
                                                .map(c => (
                                                  <button
                                                    key={c}
                                                    type="button"
                                                    onClick={() => {
                                                      addComponentToColumn(sIdx, rIdx, cIdx, c);
                                                      setActiveSearchCol(null);
                                                    }}
                                                    style={{ padding: '6px 8px', fontSize: '11px', textAlign: 'left', background: 'none', border: 'none', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', color: '#334155', width: '100%' }}
                                                    onMouseEnter={e => e.currentTarget.style.background = '#F8FAFC'}
                                                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                                                  >
                                                    <span style={{ fontSize: '12px' }}>{c === 'Heading' ? 'H' : c === 'Paragraph' ? '¶' : c === 'Button' ? '▭' : '●'}</span>
                                                    <span style={{ fontWeight: 500 }}>{c}</span>
                                                  </button>
                                                ))}
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                            <div style={{ display: 'flex', justifyContent: 'center', marginTop: '12px', marginBottom: '8px' }}>
                              <button type="button" className={styles.createBtn} style={{ padding: '6px 16px', fontSize: '11px', background: 'linear-gradient(135deg, #10B981, #059669)', border: 'none' }} onClick={(e) => { e.stopPropagation(); addRow(sIdx, '33/33/33'); }}>
                                + Add Row to Section
                              </button>
                            </div>
                            {sec.rows?.length === 0 && (
                              <div className={styles.emptyStatePlaceholder}>This section is empty. Add a Row to start.</div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                  <button type="button" className={styles.addBlockBtn} style={{ marginTop: '16px', background: '#e0e7ff' }} onClick={() => addSection('Blank Section')}>
                    + Add Section
                  </button>
                </div>
              )}
            </div>                                {/* Right Panel: Property Settings Inspector */}
            <div className={`${styles.inspectorPanel} ${isInspectorOpen ? styles.inspectorPanelOpen : styles.inspectorPanelClosed}`}>
              {!activeElement && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '32px 24px', textAlign: 'center', color: '#64748b' }}>
                  <div style={{ width: '56px', height: '56px', borderRadius: '16px', background: '#EEF2FF', color: '#4F46E5', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px', boxShadow: '0 4px 12px rgba(99,102,241,0.12)' }}>
                    <MousePointer size={28} />
                  </div>
                  <h4 style={{ fontSize: '15px', fontWeight: 700, color: '#1E293B', margin: '0 0 6px 0' }}>No Element Selected</h4>
                  <p style={{ fontSize: '12px', color: '#64748B', margin: '0 0 20px 0', lineHeight: 1.5 }}>
                    Select a component, section, or page on the canvas to edit its properties.
                  </p>
                  <button type="button" className={styles.viewModeBtn} style={{ background: '#6366F1', color: '#ffffff', borderColor: '#6366F1', padding: '8px 16px', borderRadius: '8px', fontWeight: 600 }} onClick={() => setActiveElement({ type: 'page', id: 'page' })}>
                    <Globe size={14} /> Edit Page Settings
                  </button>
                </div>
              )}
              {activeElement?.type === 'page' && (
                <>
                  <div className={styles.inspectorTitleRow}>
                    <h4>Page Settings</h4>
                    <div className={styles.inspectorTitleRight} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className={styles.inspectorBreadcrumb}>Global</span>
                      <button type="button" className={styles.closePanelBtn} onClick={() => setIsInspectorOpen(false)}>×</button>
                    </div>
                  </div>
                  {renderInspectorAccordionSection('style', 'Style / Theme', (
                    <>
                      <div className={styles.fieldGroup}>
                        <label>Primary Theme Color</label>
                        <input type="color" value={pageLayout.designSystem?.primary_color || '#4F46E5'} onChange={e => handleUpdateActiveProperty('designSystem', e.target.value, 'primary_color')} />
                      </div>
                      <div className={styles.fieldGroup}>
                        <label>Secondary Theme Color</label>
                        <input type="color" value={pageLayout.designSystem?.secondary_color || '#10B981'} onChange={e => handleUpdateActiveProperty('designSystem', e.target.value, 'secondary_color')} />
                      </div>
                      <div className={styles.fieldGroup}>
                        <label>Global Button Style</label>
                        <select value={pageLayout.designSystem?.button_style || 'solid'} onChange={e => handleUpdateActiveProperty('designSystem', e.target.value, 'button_style')}>
                          <option value="solid">Solid Fill</option>
                          <option value="outline">Outlined Border</option>
                          <option value="text">Flat Text Anchor</option>
                        </select>
                      </div>
                    </>
                  ))}
                  {renderInspectorAccordionSection('typography', 'Typography', (
                    <div className={styles.fieldGroup}>
                      <label>Typography Font Family</label>
                      <select value={pageLayout.designSystem?.fonts || 'Inter'} onChange={e => handleUpdateActiveProperty('designSystem', e.target.value, 'fonts')}>
                        <option value="Inter">Inter (Sans Serif)</option>
                        <option value="Roboto">Roboto</option>
                        <option value="Outfit">Outfit</option>
                        <option value="Georgia">Georgia (Serif)</option>
                      </select>
                    </div>
                  ))}
                  {renderInspectorAccordionSection('advanced', 'Advanced / SEO', (
                    <>
                      <div className={styles.fieldGroup}>
                        <label>SEO Header Title</label>
                        <input value={pageLayout.globalSettings?.seo_title || ''} onChange={e => handleUpdateActiveProperty('globalSettings', e.target.value, 'seo_title', true)} onBlur={commitToHistory} />
                      </div>
                      <div className={styles.fieldGroup}>
                        <label>Meta Tag Description</label>
                        <textarea rows={3} value={pageLayout.globalSettings?.meta_description || ''} onChange={e => handleUpdateActiveProperty('globalSettings', e.target.value, 'meta_description', true)} onBlur={commitToHistory} />
                      </div>
                      <div className={styles.fieldGroup}>
                        <label>Open Graph Image URL</label>
                        <div className={styles.mediaUrlInputRow}>
                          <input value={pageLayout.globalSettings?.og_image || ''} onChange={e => handleUpdateActiveProperty('globalSettings', e.target.value, 'og_image', true)} onBlur={commitToHistory} />
                          <button type="button" className={styles.uploadTriggerBtn} onClick={() => openMediaSelector((url) => { handleUpdateActiveProperty('globalSettings', url, 'og_image'); commitToHistory(); })}>Pick</button>
                        </div>
                      </div>
                    </>
                  ))}
                </>
              )}

              {activeElement?.type === 'section' && pageLayout.sections[activeElement.sectionIndex!] && (() => {
                const sec = pageLayout.sections[activeElement.sectionIndex!];
                const settings = sec.settings || {};
                if (sec.type === 'Navbar') {
                  return (
                    <>
                      <div className={styles.inspectorTitleRow}>
                        <h4>Navbar Settings</h4>
                        <div className={styles.inspectorTitleRight} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span className={styles.inspectorBreadcrumb}>Navbar</span>
                          <button type="button" className={styles.closePanelBtn} onClick={() => setIsInspectorOpen(false)}>×</button>
                        </div>
                      </div>
                      {renderInspectorAccordionSection('layout', 'Navbar Layout', (
                        <>
                          <div className={styles.fieldGroup}>
                            <label>Logo Alignment</label>
                            <select value={settings.logo_align || 'left'} onChange={e => handleUpdateActiveProperty('settings', e.target.value, 'logo_align')}>
                              <option value="left">Left</option>
                              <option value="center">Center</option>
                              <option value="right">Right</option>
                            </select>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <input type="checkbox" checked={!!settings.transparent} onChange={e => handleUpdateActiveProperty('settings', e.target.checked, 'transparent')} id="navbarTransOpt" />
                              <label htmlFor="navbarTransOpt">Transparent Header</label>
                            </div>
                          </div>
                        </>
                      ))}
                      {renderInspectorAccordionSection('logo_settings', 'Logo & Branding Image', (
                        <>
                          <div className={styles.fieldGroup}>
                            <label>Logo Image URL</label>
                            <div className={styles.mediaUrlInputRow}>
                              <input value={settings.logo_url || ''} onChange={e => handleUpdateActiveProperty('settings', e.target.value, 'logo_url', true)} onBlur={commitToHistory} placeholder="Upload or enter image URL" />
                              <button type="button" className={styles.uploadTriggerBtn} onClick={() => openMediaSelector((url) => { handleUpdateActiveProperty('settings', url, 'logo_url'); commitToHistory(); })}>Pick</button>
                            </div>
                          </div>
                          <NumericSliderInput label="Logo Width" value={settings.logo_width || 120} min={10} max={500} onChange={val => handleUpdateActiveProperty('settings', val, 'logo_width')} onBlur={commitToHistory} />
                          <NumericSliderInput label="Logo Height" value={settings.logo_height || 36} min={10} max={300} onChange={val => handleUpdateActiveProperty('settings', val, 'logo_height')} onBlur={commitToHistory} />
                          <div className={styles.fieldGroup}>
                            <label>Object Fit Mode</label>
                            <select value={settings.logo_object_fit || 'contain'} onChange={e => handleUpdateActiveProperty('settings', e.target.value, 'logo_object_fit')}>
                              <option value="contain">Contain (Fit aspect ratio)</option>
                              <option value="cover">Cover (Crop to fill)</option>
                              <option value="fill">Fill (Stretch)</option>
                              <option value="none">None</option>
                            </select>
                          </div>
                          <NumericSliderInput label="Border Radius" value={settings.logo_border_radius || 0} min={0} max={100} onChange={val => handleUpdateActiveProperty('settings', val, 'logo_border_radius')} onBlur={commitToHistory} />
                          <div className={styles.fieldGroup}>
                            <label>Device Visibility</label>
                            <select value={settings.logo_visibility || 'all'} onChange={e => handleUpdateActiveProperty('settings', e.target.value, 'logo_visibility')}>
                              <option value="all">Show on All Devices</option>
                              <option value="desktop">Desktop Only</option>
                              <option value="mobile">Mobile Only</option>
                            </select>
                          </div>
                        </>
                      ))}
                      {renderInspectorAccordionSection('company_branding', 'Company Name & Typography', (
                        <>
                          <div className={styles.fieldGroup}>
                            <label>Company Name Text</label>
                            <input value={settings.company_name || settings.logo_text || ''} onChange={e => { handleUpdateActiveProperty('settings', e.target.value, 'company_name', true); handleUpdateActiveProperty('settings', e.target.value, 'logo_text', true); }} onBlur={commitToHistory} placeholder="e.g. GrowthOS" />
                          </div>
                          <div className={styles.fieldGroup}>
                            <label>Font Family</label>
                            <select value={settings.company_font_family || 'Inter'} onChange={e => handleUpdateActiveProperty('settings', e.target.value, 'company_font_family')}>
                              <option value="Inter">Inter (Sans-Serif)</option>
                              <option value="Roboto">Roboto</option>
                              <option value="Outfit">Outfit</option>
                              <option value="Montserrat">Montserrat</option>
                              <option value="Georgia">Georgia (Serif)</option>
                            </select>
                          </div>
                          <NumericSliderInput label="Font Size" value={settings.company_font_size || 18} min={8} max={120} onChange={val => handleUpdateActiveProperty('settings', val, 'company_font_size')} onBlur={commitToHistory} />
                          <div className={styles.fieldGroup}>
                            <label>Font Weight</label>
                            <select value={settings.company_font_weight || 700} onChange={e => handleUpdateActiveProperty('settings', Number(e.target.value), 'company_font_weight')}>
                              <option value={400}>400 (Regular)</option>
                              <option value={500}>500 (Medium)</option>
                              <option value={600}>600 (Semi-Bold)</option>
                              <option value={700}>700 (Bold)</option>
                              <option value={800}>800 (Extra Bold)</option>
                              <option value={900}>900 (Black)</option>
                            </select>
                          </div>
                          <div className={styles.fieldGroup}>
                            <label>Font Style</label>
                            <select value={settings.company_font_style || 'normal'} onChange={e => handleUpdateActiveProperty('settings', e.target.value, 'company_font_style')}>
                              <option value="normal">Normal</option>
                              <option value="italic">Italic</option>
                            </select>
                          </div>
                          <div className={styles.fieldGroup}>
                            <label>Font Color</label>
                            <input type="color" value={settings.company_font_color || '#1E293B'} onChange={e => handleUpdateActiveProperty('settings', e.target.value, 'company_font_color')} />
                          </div>
                          <div className={styles.fieldGroup}>
                            <label>Hover Color</label>
                            <input type="color" value={settings.company_hover_color || '#4F46E5'} onChange={e => handleUpdateActiveProperty('settings', e.target.value, 'company_hover_color')} />
                          </div>
                          <NumericSliderInput label="Letter Spacing" value={settings.company_letter_spacing || 0} min={-5} max={20} onChange={val => handleUpdateActiveProperty('settings', val, 'company_letter_spacing')} onBlur={commitToHistory} />
                          <div className={styles.fieldGroup}>
                            <label>Text Transform</label>
                            <select value={settings.company_text_transform || 'none'} onChange={e => handleUpdateActiveProperty('settings', e.target.value, 'company_text_transform')}>
                              <option value="none">None</option>
                              <option value="uppercase">UPPERCASE</option>
                              <option value="lowercase">lowercase</option>
                              <option value="capitalize">Capitalize</option>
                            </select>
                          </div>
                        </>
                      ))}
                      {renderInspectorAccordionSection('style', 'Navbar Styles & Colors', (
                        <>
                          {renderColorPickerField('Background Color', settings.background_color, '#ffffff', (val) => handleUpdateActiveProperty('settings', val, 'background_color'))}
                          {renderColorPickerField('Nav Link Hover Color', settings.nav_hover_color, '#4F46E5', (val) => handleUpdateActiveProperty('settings', val, 'nav_hover_color'), 'inherit')}
                          {renderColorPickerField('CTA Button Background Color', settings.cta_bg_color, '#4F46E5', (val) => handleUpdateActiveProperty('settings', val, 'cta_bg_color'))}
                          {renderColorPickerField('CTA Button Text Color', settings.cta_text_color, '#FFFFFF', (val) => handleUpdateActiveProperty('settings', val, 'cta_text_color'), 'inherit')}
                          <div className={styles.fieldGroup}>
                            <label>Shadow Mode</label>
                            <select value={settings.shadow || 'light'} onChange={e => handleUpdateActiveProperty('settings', e.target.value, 'shadow')}>
                              <option value="none">None</option>
                              <option value="light">Light</option>
                              <option value="medium">Medium</option>
                              <option value="dark">Dark</option>
                            </select>
                          </div>
                          <div className={styles.fieldGroup}>
                            <label>CTA Button Text</label>
                            <input value={settings.cta_text || ''} onChange={e => handleUpdateActiveProperty('settings', e.target.value, 'cta_text', true)} onBlur={commitToHistory} />
                          </div>
                          <div className={styles.fieldGroup}>
                            <label>CTA Button URL</label>
                            <input value={settings.cta_url || ''} onChange={e => handleUpdateActiveProperty('settings', e.target.value, 'cta_url', true)} onBlur={commitToHistory} />
                          </div>
                        </>
                      ))}
                      {renderInspectorAccordionSection('advanced', 'Navigation Links & Custom CSS', (
                        <>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <label style={{ fontWeight: 600 }}>Navigation Links</label>
                            <button type="button" className={styles.createBtn} style={{ padding: '4px 8px', fontSize: '10px' }} onClick={() => {
                              const list = settings.links || [];
                              const updated = [...list, { label: 'New Link', url: '#' }];
                              handleUpdateActiveProperty('settings', updated, 'links');
                            }}>+ Add Link</button>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '280px', overflowY: 'auto', marginBottom: '12px' }}>
                            {(settings.links || []).map((l: any, lIdx: number) => (
                              <div key={lIdx} style={{ display: 'flex', flexDirection: 'column', gap: '6px', background: '#f8fafc', padding: '8px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                                <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                                  <input style={{ padding: '4px', fontSize: '11px', width: '90px', fontWeight: 600 }} placeholder="Label" value={l.label || ''} onChange={e => {
                                    const list = [...settings.links];
                                    list[lIdx] = { ...list[lIdx], label: e.target.value };
                                    handleUpdateActiveProperty('settings', list, 'links');
                                  }} />
                                  <input style={{ padding: '4px', fontSize: '11px', flex: 1 }} placeholder="URL" value={l.url || ''} onChange={e => {
                                    const list = [...settings.links];
                                    list[lIdx] = { ...list[lIdx], url: e.target.value };
                                    handleUpdateActiveProperty('settings', list, 'links');
                                  }} />
                                  <button type="button" style={{ border: 'none', background: '#fecaca', color: '#b91c1c', cursor: 'pointer', padding: '3px 7px', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold' }} onClick={() => {
                                    const list = settings.links.filter((_: any, i: number) => i !== lIdx);
                                    handleUpdateActiveProperty('settings', list, 'links');
                                  }}>×</button>
                                </div>
                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '10px', color: '#64748b' }}>
                                  <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    Color:
                                    <input type="color" value={l.color || settings.nav_color || '#475569'} onChange={e => {
                                      const list = [...settings.links];
                                      list[lIdx] = { ...list[lIdx], color: e.target.value };
                                      handleUpdateActiveProperty('settings', list, 'links');
                                    }} style={{ width: '22px', height: '22px', border: 'none', padding: 0, cursor: 'pointer' }} />
                                  </label>
                                  <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    Style:
                                    <select value={l.font_style || 'normal'} onChange={e => {
                                      const list = [...settings.links];
                                      list[lIdx] = { ...list[lIdx], font_style: e.target.value };
                                      handleUpdateActiveProperty('settings', list, 'links');
                                    }} style={{ fontSize: '10px', padding: '2px 4px' }}>
                                      <option value="normal">Normal</option>
                                      <option value="italic">Italic</option>
                                    </select>
                                  </label>
                                </div>
                              </div>
                            ))}
                          </div>
                          <div className={styles.fieldGroup}>
                            <label>Section Scoped CSS</label>
                            <textarea rows={6} placeholder="/* Custom CSS */" value={settings.custom_css || ''} onChange={e => handleUpdateActiveProperty('settings', e.target.value, 'custom_css', true)} onBlur={commitToHistory} style={{ fontFamily: 'monospace', fontSize: '11px' }} />
                          </div>
                        </>
                      ))}
                    </>
                  );
                }

                return (
                  <>
                    <div className={styles.inspectorTitleRow}>
                      <h4>Section Settings</h4>
                      <div className={styles.inspectorTitleRight} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className={styles.inspectorBreadcrumb}>{sec.name}</span>
                        <button type="button" className={styles.closePanelBtn} onClick={() => setIsInspectorOpen(false)}>×</button>
                      </div>
                    </div>
                    {renderInspectorAccordionSection('layout_section_custom', 'Section Custom Properties', (
                      <>
                        <div className={styles.fieldGroup}>
                          <label>Background Image URL</label>
                          <div className={styles.mediaUrlInputRow}>
                            <input value={settings.background_image || ''} onChange={e => handleUpdateActiveProperty('settings', e.target.value, 'background_image', true)} onBlur={commitToHistory} />
                            <button type='button' className={styles.uploadTriggerBtn} onClick={() => openMediaSelector((url) => { handleUpdateActiveProperty('settings', url, 'background_image'); commitToHistory(); })}>Pick</button>
                          </div>
                        </div>
                        <div className={styles.fieldGroup}>
                          <label>Section Scoped CSS</label>
                          <textarea rows={6} placeholder='/* Custom CSS */' value={settings.custom_css || ''} onChange={e => handleUpdateActiveProperty('settings', e.target.value, 'custom_css', true)} onBlur={commitToHistory} style={{ fontFamily: 'monospace', fontSize: '11px' }} />
                        </div>
                      </>
                    ))}
                    {renderUniversalLayoutInspector()}
                  </>
                );
              })()}

              {activeElement?.type === 'row' && pageLayout.sections[activeElement.sectionIndex!] && (() => {
                const row = pageLayout.sections[activeElement.sectionIndex!].rows[activeElement.rowIndex!];
                return (
                  <>
                    <div className={styles.inspectorTitleRow}>
                      <h4>Row Settings</h4>
                      <div className={styles.inspectorTitleRight} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className={styles.inspectorBreadcrumb}>Row ${activeElement.rowIndex! + 1}</span>
                        <button type='button' className={styles.closePanelBtn} onClick={() => setIsInspectorOpen(false)}>×</button>
                      </div>
                    </div>
                    <div className={styles.inspectorGroup} style={{ padding: '16px' }}>
                      {renderUniversalLayoutInspector()}
                    </div>
                  </>
                );
              })()}

              {activeElement?.type === 'column' && pageLayout.sections[activeElement.sectionIndex!] && (() => {
                const col = pageLayout.sections[activeElement.sectionIndex!].rows[activeElement.rowIndex!].columns[activeElement.columnIndex!];
                return (
                  <>
                    <div className={styles.inspectorTitleRow}>
                      <h4>Column Settings</h4>
                      <div className={styles.inspectorTitleRight} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className={styles.inspectorBreadcrumb}>Col ${activeElement.columnIndex! + 1} (${col.width})</span>
                        <button type='button' className={styles.closePanelBtn} onClick={() => setIsInspectorOpen(false)}>×</button>
                      </div>
                    </div>
                    <div className={styles.inspectorGroup} style={{ padding: '16px' }}>
                      {renderUniversalLayoutInspector()}
                    </div>
                  </>
                );
              })()}

              {activeElement?.type === 'component' && pageLayout.sections[activeElement.sectionIndex!] && (() => {
                const comp = pageLayout.sections[activeElement.sectionIndex!].rows[activeElement.rowIndex!].columns[activeElement.columnIndex!].components[activeElement.index!];
                let parsedConfig: any = {};
                try {
                  parsedConfig = typeof comp.config === 'string' ? JSON.parse(comp.config || '{}') : (comp.config || {});
                } catch { }
                return (
                  <>
                    <div className={styles.inspectorTitleRow}>
                      <h4>Component Settings</h4>
                      <div className={styles.inspectorTitleRight} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className={styles.inspectorBreadcrumb}>{comp.type}</span>
                        <button type="button" className={styles.closePanelBtn} onClick={() => setIsInspectorOpen(false)}>×</button>
                      </div>
                    </div>
                    <div className={styles.inspectorGroup} style={{ padding: '16px' }}>
                      {renderComponentSettings(comp, parsedConfig)}
                      {['Heading', 'Paragraph', 'Text', 'FeatureText', 'ListItems'].includes(comp.type) &&
                        renderLinkSettingsPanel(parsedConfig, (key, val) => handleUpdateActiveProperty('config', val, key))}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>


          <div className={styles.editorActions}>
            <button
              type="button"
              className={styles.backToCrmBtn}
              onClick={() => setEditingStep(null)}
            >
              <ArrowLeft size={15} /> Back to CRM
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <button type="button" className={styles.cancelBtn} onClick={() => setEditingStep(null)}>
                Cancel
              </button>
              <button type="button" className={styles.saveBtn} onClick={() => handleSaveStep()} disabled={savingStep}>
                {savingStep ? 'Saving…' : 'Save Step Layout'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>


          {/* Header */}
          <div className={styles.header}>
            <div>
              <h1>Funnels</h1>
              <p className={styles.headerSub}>Build, configure, and publish marketing funnels with Assets & Actions</p>
            </div>
            <button className={styles.createBtn} onClick={() => setIsCreateModalOpen(true)}>
              <Plus size={16} /> New Funnel
            </button>
          </div>

          <div className={styles.contentLayout}>
            {/* Funnels List */}
            <div className={styles.funnelsList}>
              <p className={styles.listLabel}>YOUR FUNNELS</p>
              {funnels.map(funnel => (
                <div
                  key={funnel.id}
                  className={`${styles.funnelItem} ${selectedFunnel?.id === funnel.id ? styles.active : ''}`}
                  onClick={() => handleSelectFunnel(funnel)}
                >
                  <div className={styles.funnelItemHeader}>
                    <h3>{funnel.name}</h3>
                    <span className={`${styles.statusBadge} ${funnel.status === 'Published' ? styles.publishedBadge : styles.draftBadge}`}>
                      {funnel.status === 'Published' ? <Globe size={10} /> : null}
                      {funnel.status || 'Draft'}
                    </span>
                  </div>
                  {funnel.description && <p className={styles.funnelDesc}>{funnel.description}</p>}
                </div>
              ))}
            </div>

            {/* Details Panel */}
            <div className={styles.funnelDetails}>
              {selectedFunnel ? (
                <>
                  {/* Funnel header */}
                  <div className={styles.detailsHeader}>
                    <div>
                      <h2>{selectedFunnel.name}</h2>
                      {selectedFunnel.description && <p className={styles.detailsDesc}>{selectedFunnel.description}</p>}
                    </div>
                    <div className={styles.headerActions}>
                      {selectedFunnel.status === 'Published' ? (
                        <button className={styles.unpublishBtn} onClick={handleUnpublish} disabled={publishing}>
                          <EyeOff size={14} /> {publishing ? 'Updating…' : 'Unpublish'}
                        </button>
                      ) : (
                        <button className={styles.publishBtn} onClick={handlePublish} disabled={publishing || steps.length === 0}>
                          <Globe size={14} /> {publishing ? 'Publishing…' : 'Publish'}
                        </button>
                      )}
                      <button className={styles.deleteBtn} onClick={handleDeleteFunnel}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {/* URL Bar — always visible, adapts to published/draft state */}
                  <div className={styles.publicUrlBar}>
                    {publicUrl ? (
                      <>
                        <Globe size={14} className={styles.urlIcon} />
                        <span className={styles.urlText}>{publicUrl}</span>
                        <button className={styles.copyBtn} onClick={handleCopyLink}>
                          {copied ? <Check size={13} /> : <Copy size={13} />}
                          {copied ? 'Copied!' : 'Copy'}
                        </button>
                        <a
                          href={publicUrl || '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.previewBtn}
                          onClick={(e) => {
                            if (!publicUrl) e.preventDefault();
                          }}
                        >
                          <Eye size={13} /> Preview Live
                        </a>
                      </>
                    ) : (
                      <>
                        <AlertCircle size={14} className={styles.urlIcon} style={{ color: '#F59E0B' }} />
                        <span className={styles.urlText} style={{ color: '#9CA3AF', fontStyle: 'italic' }}>
                          Draft — not yet published
                        </span>
                        <a
                          href={selectedFunnel?.id ? `${window.location.origin}/funnel/${selectedFunnel.id}?preview=true` : '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.previewBtn}
                          onClick={(e) => {
                            if (!selectedFunnel?.id) e.preventDefault();
                          }}
                        >
                          <Eye size={13} /> Preview Draft
                        </a>
                      </>
                    )}
                  </div>


                  {/* Switch Tabs */}
                  <div className={styles.tabRow}>
                    <button className={`${styles.tab} ${activeTab === 'builder' ? styles.activeTab : ''}`} onClick={() => setActiveTab('builder')}>
                      <LayoutTemplate size={14} /> Builder
                    </button>
                    <button className={`${styles.tab} ${activeTab === 'analytics' ? styles.activeTab : ''}`} onClick={() => setActiveTab('analytics')}>
                      <BarChart2 size={14} /> Analytics
                    </button>
                  </div>

                  {/* Builder tab */}
                  {activeTab === 'builder' && (
                    <div className={styles.builderArea}>
                      <div className={styles.stepsColumn}>
                        <div className={styles.stepsHeader}>
                          <span>{steps.length} Steps</span>
                          <button
                            type="button"
                            className={styles.addStepBtn}
                            onClick={() => {
                              setNewStep({ name: '', order: steps.length + 1 });
                              setIsStepModalOpen(true);
                            }}
                          >
                            <Plus size={14} /> Add Step
                          </button>
                        </div>

                        {steps.length === 0 && (
                          <div className={styles.emptySteps}>
                            <LayoutTemplate size={28} style={{ opacity: 0.3, marginBottom: '8px' }} />
                            <p style={{ margin: '0 0 12px 0' }}>No steps yet. Add one to start building.</p>
                            <button
                              type="button"
                              className={styles.addStepBtn}
                              style={{ padding: '8px 16px', fontSize: '13px', borderRadius: '8px' }}
                              onClick={() => {
                                setNewStep({ name: '', order: 1 });
                                setIsStepModalOpen(true);
                              }}
                            >
                              <Plus size={14} /> Add First Step
                            </button>
                          </div>
                        )}

                        {steps.map((step, i) => {
                          const isEditing = editingStep?.id === step.id;
                          return (
                            <div key={step.id} className={`${styles.stepCard} ${isEditing ? styles.editingCard : ''}`}>
                              <div className={styles.stepCardHeader} onClick={() => {
                                if (isEditing) {
                                  setEditingStep(null);
                                } else {
                                  handleEditStepStart(step);
                                }
                              }}>
                                <div className={styles.stepIndex}>{i + 1}</div>
                                <div className={styles.stepCardInfo}>
                                  <strong>{step.name}</strong>
                                </div>
                                <div className={styles.stepCardActions}>
                                  <button className={styles.iconBtn} title="Move Up" disabled={i === 0} onClick={e => { e.stopPropagation(); handleMoveStep(i, 'up'); }}>
                                    <ArrowUp size={13} />
                                  </button>
                                  <button className={styles.iconBtn} title="Move Down" disabled={i === steps.length - 1} onClick={e => { e.stopPropagation(); handleMoveStep(i, 'down'); }}>
                                    <ArrowDown size={13} />
                                  </button>
                                  <button className={styles.iconBtn} title="Duplicate Step" onClick={e => { e.stopPropagation(); handleDuplicateStep(step); }}>
                                    <CopyPlus size={13} />
                                  </button>
                                  <button className={`${styles.iconBtn} ${styles.deleteIconBtn}`} title="Delete step" onClick={e => { e.stopPropagation(); handleDeleteStep(step.id); }}>
                                    <Trash2 size={13} />
                                  </button>
                                  {isEditing ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                </div>
                              </div>

                              {/* Expanded Step Editor has been moved to top-level return */}
                              {i < steps.length - 1 && (
                                <div className={styles.stepArrow}><ArrowRight size={14} /></div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Analytics tab */}
                  {activeTab === 'analytics' && (
                    <div className={styles.analyticsArea}>
                      {!analytics ? (
                        <div className={styles.loadingAnalytics}>Loading analytics…</div>
                      ) : (
                        <>
                          <div className={styles.analyticsCards}>
                            <div className={styles.analyticsCard}>
                              <span className={styles.analyticsLabel}>Total Visitors</span>
                              <span className={styles.analyticsValue}>{analytics.unique_visitors}</span>
                            </div>
                            <div className={styles.analyticsCard}>
                              <span className={styles.analyticsLabel}>Form Submissions</span>
                              <span className={styles.analyticsValue}>{analytics.form_submissions}</span>
                            </div>
                            <div className={styles.analyticsCard}>
                              <span className={styles.analyticsLabel}>Conversion Rate</span>
                              <span className={`${styles.analyticsValue} ${styles.green}`}>
                                {analytics.conversion_rate.toFixed(1)}%
                              </span>
                            </div>
                            <div className={styles.analyticsCard}>
                              <span className={styles.analyticsLabel}>Most Visited Step</span>
                              <span className={styles.analyticsValue} style={{ fontSize: '14px' }}>
                                {analytics.most_visited_step || '—'}
                              </span>
                            </div>
                          </div>

                          <div className={styles.stepDropoffs}>
                            <h3 className={styles.dropoffTitle}>Step-by-step Drop-off</h3>
                            {analytics.steps.map((s, i) => (
                              <div key={s.step_id} className={styles.dropoffRow}>
                                <div className={styles.dropoffStepName}>
                                  <span className={styles.dropoffIndex}>{i + 1}</span>
                                  {s.name}
                                </div>
                                <div className={styles.dropoffBar}>
                                  <div
                                    className={styles.dropoffFill}
                                    style={{ width: `${Math.max(s.visits > 0 ? (s.visits / (analytics.unique_visitors || 1)) * 100 : 0, 2)}%` }}
                                  />
                                </div>
                                <div className={styles.dropoffStats}>
                                  <span>{s.visits} visits</span>
                                  <span className={styles.dropoffPct}>{s.drop_off_rate.toFixed(0)}% drop-off</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className={styles.noSelection}>
                  <LayoutTemplate size={48} style={{ opacity: 0.2, marginBottom: '16px' }} />
                  <h3>Select a funnel</h3>
                  <p>Choose a funnel from the list to build and track it.</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}


      {/* Create Funnel Modal */}
      {isCreateModalOpen && (
        <div className={styles.modalOverlay} onClick={() => setIsCreateModalOpen(false)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()} style={{ maxWidth: '560px', width: '90%' }}>
            <div className={styles.modalHeaderRow}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#EEF2FF', color: '#6366F1', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Plus size={20} />
                </div>
                <div>
                  <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: '#1E293B' }}>Create New Funnel</h2>
                  <p style={{ fontSize: '12px', color: '#64748B', margin: '2px 0 0 0' }}>Build a high-converting lead generation or sales funnel.</p>
                </div>
              </div>
              <button type="button" className={styles.closeModalBtn} onClick={() => setIsCreateModalOpen(false)}>×</button>
            </div>

            <form onSubmit={handleCreateFunnel} style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                  Funnel Name <span style={{ color: '#EF4444' }}>*</span>
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  placeholder="e.g. Q3 Growth Campaign, Masterclass Registration..."
                  value={newFunnel.name}
                  onChange={e => setNewFunnel(prev => ({ ...prev, name: e.target.value }))}
                  style={{ width: '100%', padding: '10px 14px', fontSize: '14px', border: '1px solid #CBD5E1', borderRadius: '8px', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                  Description (Optional)
                </label>
                <textarea
                  placeholder="Brief summary of this funnel's objective..."
                  value={newFunnel.description}
                  onChange={e => setNewFunnel(prev => ({ ...prev, description: e.target.value }))}
                  rows={3}
                  style={{ width: '100%', padding: '10px 14px', fontSize: '13px', border: '1px solid #CBD5E1', borderRadius: '8px', outline: 'none', boxSizing: 'border-box', resize: 'vertical' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                  Funnel Goal / Type
                </label>
                <select
                  value={newFunnel.type}
                  onChange={e => setNewFunnel(prev => ({ ...prev, type: e.target.value }))}
                  style={{ width: '100%', padding: '10px 14px', fontSize: '13px', border: '1px solid #CBD5E1', borderRadius: '8px', outline: 'none', background: '#FFF' }}
                >
                  <option value="Lead">Lead Capture & Opt-in</option>
                  <option value="Sales">Direct Sales & Checkout</option>
                  <option value="Webinar">Webinar & Event Booking</option>
                  <option value="Appointment">Consultation Scheduling</option>
                </select>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px', paddingTop: '16px', borderTop: '1px solid #F1F5F9' }}>
                <button
                  type="button"
                  className={styles.viewModeBtn}
                  onClick={() => setIsCreateModalOpen(false)}
                  style={{ padding: '8px 16px', borderRadius: '8px', fontSize: '13px' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newFunnel.name.trim()}
                  style={{
                    padding: '8px 20px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 600,
                    background: !newFunnel.name.trim() ? '#C7D2FE' : 'linear-gradient(135deg, #6366F1, #4F46E5)',
                    color: '#FFFFFF',
                    border: 'none',
                    cursor: !newFunnel.name.trim() ? 'not-allowed' : 'pointer',
                    boxShadow: '0 2px 6px rgba(99, 102, 241, 0.25)'
                  }}
                >
                  Create Funnel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Funnel Step Modal */}
      {isStepModalOpen && (
        <div className={styles.modalOverlay} onClick={() => setIsStepModalOpen(false)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()} style={{ maxWidth: '520px', width: '90%' }}>
            <div className={styles.modalHeaderRow}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#EEF2FF', color: '#6366F1', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Plus size={20} />
                </div>
                <div>
                  <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: '#1E293B' }}>Add Funnel Step</h2>
                  <p style={{ fontSize: '12px', color: '#64748B', margin: '2px 0 0 0' }}>Create a new page step to build out your sales funnel flow.</p>
                </div>
              </div>
              <button type="button" className={styles.closeModalBtn} onClick={() => setIsStepModalOpen(false)}>×</button>
            </div>

            <form onSubmit={handleCreateStep} style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                  Step Name <span style={{ color: '#EF4444' }}>*</span>
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  placeholder="e.g. Sales Page, Checkout Form, Thank You Page..."
                  value={newStep.name || ''}
                  onChange={e => setNewStep(prev => ({ ...prev, name: e.target.value }))}
                  style={{ width: '100%', padding: '10px 14px', fontSize: '14px', border: '1px solid #CBD5E1', borderRadius: '8px', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#64748B', marginBottom: '8px' }}>
                  Quick Presets / Popular Step Types:
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {[
                    { label: '🚀 Landing Page', value: 'Landing Page' },
                    { label: '🛒 Checkout Page', value: 'Checkout' },
                    { label: '🎁 Special Upsell', value: 'Upsell Offer' },
                    { label: '🎉 Thank You Page', value: 'Thank You Page' },
                    { label: '📋 Opt-in Form', value: 'Lead Capture' },
                    { label: '📞 Calendar Booking', value: 'Calendar Booking' }
                  ].map(preset => (
                    <button
                      key={preset.value}
                      type="button"
                      onClick={() => setNewStep(prev => ({ ...prev, name: preset.value }))}
                      style={{
                        padding: '6px 12px',
                        fontSize: '12px',
                        fontWeight: 500,
                        borderRadius: '20px',
                        border: newStep.name === preset.value ? '1.5px solid #6366F1' : '1px solid #E2E8F0',
                        background: newStep.name === preset.value ? '#EEF2FF' : '#F8FAFC',
                        color: newStep.name === preset.value ? '#4F46E5' : '#475569',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px', paddingTop: '16px', borderTop: '1px solid #F1F5F9' }}>
                <button
                  type="button"
                  className={styles.viewModeBtn}
                  onClick={() => setIsStepModalOpen(false)}
                  style={{ padding: '8px 16px', borderRadius: '8px', fontSize: '13px' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addingStep || !newStep.name?.trim()}
                  style={{
                    padding: '8px 20px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 600,
                    background: addingStep || !newStep.name?.trim() ? '#C7D2FE' : 'linear-gradient(135deg, #6366F1, #4F46E5)',
                    color: '#FFFFFF',
                    border: 'none',
                    cursor: addingStep || !newStep.name?.trim() ? 'not-allowed' : 'pointer',
                    boxShadow: '0 2px 6px rgba(99, 102, 241, 0.25)'
                  }}
                >
                  {addingStep ? 'Creating Step...' : '+ Add Step'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Section Library Modal */}
      {isSectionLibraryModalOpen && (
        <div className={styles.modalOverlay} onClick={() => setIsSectionLibraryModalOpen(false)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()} style={{ maxWidth: '720px' }}>
            <div className={styles.modalHeaderRow}>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: '#1E293B' }}>Add a New Section</h2>
                <p style={{ fontSize: '12px', color: '#64748B', margin: '2px 0 0 0' }}>Select a pre-designed layout section to insert into your landing page.</p>
              </div>
              <button type="button" className={styles.closeModalBtn} onClick={() => setIsSectionLibraryModalOpen(false)}>×</button>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <input
                placeholder="Search section presets (Hero, Pricing, Features, Form, etc.)…"
                value={sectionSearchQuery}
                onChange={e => setSectionSearchQuery(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', fontSize: '13px', border: '1px solid #CBD5E1', borderRadius: '8px', outline: 'none', boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px', maxHeight: '420px', overflowY: 'auto', paddingRight: '4px' }}>
              {[
                { name: 'Navbar', icon: '🚀', category: 'Headers', desc: 'Header navigation & company branding' },
                { name: 'Hero', icon: '⚡', category: 'Hero', desc: 'Primary value proposition & CTA' },
                { name: 'Features', icon: '✨', category: 'Features', desc: '3-column product features grid' },
                { name: 'Benefits', icon: '💎', category: 'Benefits', desc: '2-column value proposition breakdown' },
                { name: 'Pricing', icon: '🏷️', category: 'Pricing', desc: '3-tier subscription pricing cards' },
                { name: 'About', icon: '🎯', category: 'About', desc: 'Company mission & team statement' },
                { name: '2-Column Section', icon: '📊', category: 'Layouts', desc: '2 equal columns layout' },
                { name: 'Lead Generation', icon: '📋', category: 'Forms', desc: 'Form capture & lead generation' },
                { name: 'CTA', icon: '🔥', category: 'Call to Action', desc: 'Primary call-to-action button & headline' },
                { name: 'Footer', icon: '⚓', category: 'Footers', desc: 'Footer links, copyright, & social handles' },
                { name: 'Blank Section', icon: '➕', category: 'Custom', desc: 'Empty section ready for custom rows' },
              ]
                .filter(item => item.name.toLowerCase().includes(sectionSearchQuery.toLowerCase()) || item.desc.toLowerCase().includes(sectionSearchQuery.toLowerCase()))
                .map(preset => (
                  <div
                    key={preset.name}
                    style={{
                      border: '1px solid #E2E8F0',
                      borderRadius: '12px',
                      padding: '16px',
                      background: '#FFFFFF',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between'
                    }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLDivElement).style.borderColor = '#6366F1';
                      (e.currentTarget as HTMLDivElement).style.boxShadow = '0 8px 20px rgba(99, 102, 241, 0.12)';
                      (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)';
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLDivElement).style.borderColor = '#E2E8F0';
                      (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
                      (e.currentTarget as HTMLDivElement).style.transform = 'none';
                    }}
                    onClick={() => {
                      addSection(preset.name);
                      setIsSectionLibraryModalOpen(false);
                      setSectionSearchQuery('');
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '28px', marginBottom: '8px' }}>{preset.icon}</div>
                      <h4 style={{ fontSize: '14px', fontWeight: 700, color: '#1E293B', margin: '0 0 4px 0' }}>{preset.name}</h4>
                      <p style={{ fontSize: '11px', color: '#64748B', margin: 0, lineHeight: 1.4 }}>{preset.desc}</p>
                    </div>
                    <div style={{ marginTop: '12px', fontSize: '11px', fontWeight: 600, color: '#6366F1', textAlign: 'right' }}>
                      Insert Section +
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* Asset Library Upload Selector Modal */}
      {isMediaModalOpen && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent} style={{ maxWidth: '680px' }}>
            <div className={styles.modalHeaderRow}>
              <h2>Media Asset Library</h2>
              <button type="button" className={styles.closeModalBtn} onClick={() => setIsMediaModalOpen(false)}>×</button>
            </div>

            {/* Upload Zone */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={triggerFileUpload}
              style={{
                border: '2px dashed #cbd5e1',
                borderRadius: '12px',
                padding: '20px',
                textAlign: 'center',
                cursor: 'pointer',
                marginBottom: '16px',
                background: isDragging ? '#e2e8f0' : '#f8fafc',
                transition: 'all 0.2s ease',
              }}
            >
              <p style={{ margin: 0, fontWeight: 600, color: '#475569', fontSize: '13px' }}>
                {isDragging ? 'Drop file here to upload!' : '📁 Drag & Drop files here, or click to browse'}
              </p>
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>Supports Images and Videos</span>
              <input
                type="file"
                ref={fileInputRef}
                style={{ display: 'none' }}
                accept="image/*,video/*,application/pdf"
                onChange={handleUploadFile}
              />
            </div>

            {/* Search / Filter / Sort Bar */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
              <input
                placeholder="Search assets…"
                value={mediaSearchQuery}
                onChange={e => setMediaSearchQuery(e.target.value)}
                style={{ flex: 1, minWidth: '140px', padding: '6px 10px', fontSize: '12px', border: '1px solid #e2e8f0', borderRadius: '8px', outline: 'none' }}
              />
              <select value={mediaTypeFilter} onChange={e => setMediaTypeFilter(e.target.value as any)} style={{ padding: '6px 8px', fontSize: '12px', border: '1px solid #e2e8f0', borderRadius: '8px', background: '#fff' }}>
                <option value="all">All Types</option>
                <option value="image">Images</option>
                <option value="video">Videos</option>
              </select>
              <select value={mediaSortOrder} onChange={e => setMediaSortOrder(e.target.value as any)} style={{ padding: '6px 8px', fontSize: '12px', border: '1px solid #e2e8f0', borderRadius: '8px', background: '#fff' }}>
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
                <option value="name">Name A–Z</option>
              </select>
            </div>

            {/* Assets Grid */}
            <div style={{ maxHeight: '320px', overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '10px' }}>
              {mediaLibrary
                .filter(asset => {
                  const name = (asset.filename || '').toLowerCase();
                  const matchSearch = name.includes(mediaSearchQuery.toLowerCase());
                  const isVid = asset.content_type?.startsWith('video/') || asset.filename?.endsWith('.mp4') || asset.filename?.endsWith('.webm');
                  const matchType = mediaTypeFilter === 'all' || (mediaTypeFilter === 'video' ? isVid : !isVid);
                  return matchSearch && matchType;
                })
                .sort((a, b) => {
                  if (mediaSortOrder === 'newest') return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
                  if (mediaSortOrder === 'oldest') return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
                  return (a.filename || '').localeCompare(b.filename || '');
                })
                .map((asset) => {
                  const isVideo = asset.content_type?.startsWith('video/') || asset.filename?.endsWith('.mp4') || asset.filename?.endsWith('.webm');
                  return (
                    <div
                      key={asset.id}
                      style={{ cursor: 'pointer', border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '6px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', background: '#fff', position: 'relative', transition: 'border-color 0.15s, box-shadow 0.15s' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#6366F1'; (e.currentTarget as HTMLDivElement).style.boxShadow = '0 0 0 2px #e0e7ff'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#e2e8f0'; (e.currentTarget as HTMLDivElement).style.boxShadow = 'none'; }}
                      onClick={() => handleSelectAsset(asset.url)}
                    >
                      {/* Delete button */}
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (!confirm(`Delete "${asset.filename}"?`)) return;
                          try {
                            await funnelsApi.deleteMediaAsset(asset.id);
                            setMediaLibrary(prev => prev.filter(a => a.id !== asset.id));
                            showToast('Asset deleted.');
                          } catch {
                            showToast('Failed to delete asset.', 'error');
                          }
                        }}
                        style={{
                          position: 'absolute', top: '4px', right: '4px',
                          width: '18px', height: '18px',
                          background: '#ef4444', color: '#fff', border: 'none',
                          borderRadius: '50%', fontSize: '10px', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          zIndex: 2, opacity: 0, transition: 'opacity 0.15s'
                        }}
                        className="assetDeleteBtn"
                      >×</button>

                      {isVideo ? (
                        <div style={{ width: '100%', height: '72px', background: '#1a1a2e', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#a78bfa', fontSize: '20px' }}>
                          🎥
                        </div>
                      ) : (
                        <img
                          src={`http://localhost:8000${asset.url}`}
                          alt={asset.filename}
                          style={{ width: '100%', height: '72px', objectFit: 'cover', borderRadius: '6px' }}
                        />
                      )}
                      <span style={{ fontSize: '10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%', textAlign: 'center', color: '#475569' }}>
                        {asset.filename}
                      </span>
                    </div>
                  );
                })}
              {mediaLibrary.filter(a => (a.filename || '').toLowerCase().includes(mediaSearchQuery.toLowerCase())).length === 0 && (
                <p style={{ gridColumn: '1 / -1', textAlign: 'center', color: '#94a3b8', fontSize: '13px', padding: '20px 0' }}>
                  No matching assets found.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
