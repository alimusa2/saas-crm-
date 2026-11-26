import { normalizeLayoutSettings, compileElementLayoutCSS } from '../../lib/styleEngine';
import React, { useState, useEffect, useCallback } from 'react';
import type { Funnel, FunnelStep } from '../../lib/api';
import { API_BASE, BACKEND_URL, resolveAssetUrl } from '../../lib/api';
import { formsApi } from '../../lib/api';
import type { Form, FormField } from '../../lib/api';
import { getFormTheme } from './FormBuilderModal';
import { GoogleCalendarWidget } from './GoogleCalendarWidget';

interface PublicFunnelPageProps {
  funnelId: string;
}

const BASE = API_BASE;

// resolveAssetUrl imported from ../../lib/api

const parseColWidthFlex = (w: any): { flex: string; width?: string } => {
  if (!w) return { flex: '1 1 0%' };
  const str = String(w).trim().toLowerCase();
  if (str === '100%' || str === '1/1' || str.includes('100')) {
    return { flex: '1 1 100%', width: '100%' };
  }
  if (str === '50/50' || str === '1/2' || str.includes('50')) {
    return { flex: '1 1 0%', width: '50%' };
  }
  if (str === '1/3' || str === '33/33/33' || str.includes('33') || str.includes('1/3')) {
    return { flex: '1 1 0%', width: '33.3333%' };
  }
  if (str === '1/4' || str === '25/25/25/25' || str.includes('25') || str.includes('1/4')) {
    return { flex: '1 1 0%', width: '25%' };
  }
  if (str === '1/5' || str.includes('20') || str.includes('1/5')) {
    return { flex: '1 1 0%', width: '20%' };
  }
  if (str === '2/3' || str.includes('66')) {
    return { flex: '2 2 0%', width: '66.6666%' };
  }
  if (str === '3/4' || str.includes('75')) {
    return { flex: '3 3 0%', width: '75%' };
  }
  return { flex: '1 1 0%' };
};

function getOrCreateSessionId(): string {
  let sid = sessionStorage.getItem('funnel_session_id');
  if (!sid) {
    sid = `fs_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    sessionStorage.setItem('funnel_session_id', sid);
  }
  return sid;
}

function getUtmParams(): Record<string, string> {
  const params = new URLSearchParams(window.location.search);
  const keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
  const result: Record<string, string> = {};
  keys.forEach(k => { const v = params.get(k); if (v) result[k] = v; });
  return result;
}

async function trackEvent(funnelId: string, stepId: string, event: string, conversion = false) {
  try {
    const sid = getOrCreateSessionId();
    const utms = getUtmParams();
    await fetch(`${BASE}/funnels/public/${funnelId}/visit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step_id: stepId, event_type: event, session_id: sid, converted: conversion, ...utms })
    });
  } catch { }
}

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


const wrapTextWithLink = (content: React.ReactNode, cfg: any): React.ReactNode => {
  if (!cfg || !cfg.link_url) return content;
  const linkUrl = normalizeUrl(cfg.link_url);
  const target = cfg.link_target || '_self';
  const rel = cfg.link_rel && cfg.link_rel !== 'none' ? cfg.link_rel : undefined;
  const underline = cfg.link_underline || 'hover';
  const linkColor = cfg.link_color || 'inherit';
  const hoverColor = cfg.link_hover_color;

  const style: React.CSSProperties = {
    color: linkColor,
    textDecoration: underline === 'always' ? 'underline' : underline === 'none' ? 'none' : undefined,
    transition: 'color 0.15s ease',
  };

  return (
    <a
      href={linkUrl}
      target={target}
      rel={rel}
      aria-label={cfg.link_aria_label || undefined}
      style={style}
      onMouseEnter={e => {
        if (hoverColor) e.currentTarget.style.color = hoverColor;
        if (underline === 'hover') e.currentTarget.style.textDecoration = 'underline';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.color = linkColor;
        if (underline === 'hover') e.currentTarget.style.textDecoration = underline === 'always' ? 'underline' : 'none';
      }}
    >
      {content}
    </a>
  );
};

const parseVideoUrl = (url: string): { provider: 'youtube' | 'vimeo' | 'html5' | 'unknown' | 'none'; id: string } => {
  if (!url) return { provider: 'none', id: '' };
  const trimmed = url.trim();
  const ytRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i;
  const ytMatch = trimmed.match(ytRegex);
  if (ytMatch) return { provider: 'youtube', id: ytMatch[1] };
  const vimeoRegex = /(?:https?:\/\/)?(?:www\.)?(?:vimeo\.com\/)(?:channels\/(?:\w+\/)?|groups\/([^\/]*)\/videos\/|album\/(\d+)\/video\/|video\/|)(\d+)(?:$|\/|\?)/i;
  const vimeoMatch = trimmed.match(vimeoRegex);
  if (vimeoMatch) return { provider: 'vimeo', id: vimeoMatch[3] };
  const ext = trimmed.split('.').pop()?.split('?')[0]?.toLowerCase() || '';
  const isDirectVideo = ['mp4', 'mov', 'webm', 'avi', 'ogv', 'm4v'].includes(ext) || trimmed.startsWith('/static/');
  if (isDirectVideo) return { provider: 'html5', id: trimmed };
  return { provider: 'unknown', id: trimmed };
};

const validateCssSyntax = (css: string): { isValid: boolean; error?: string } => {
  try {
    if (!css || !css.trim()) return { isValid: true };
    let openBraces = 0;
    for (let i = 0; i < css.length; i++) {
      if (css[i] === '{') openBraces++;
      if (css[i] === '}') {
        openBraces--;
        if (openBraces < 0) return { isValid: false, error: 'Mismatched closing brace "}" without a preceding opening brace.' };
      }
    }
    if (openBraces > 0) return { isValid: false, error: `Unclosed style block. Missing ${openBraces} closing brace(s) "}".` };
    return { isValid: true };
  } catch (err) {
    console.error("validateCssSyntax error:", err);
    return { isValid: false, error: "Internal CSS validation error" };
  }
};

const scopeCss = (css: string, prefix: string): string => {
  try {
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
  } catch (err) {
    console.error("scopeCss error:", err);
    return '';
  }
};

const compilePageStyles = (layout: any): string => {
  if (!layout) return '';
  let compiled = '';

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
          font-family: ${s.company_font_family || s.logo_font_family || 'inherit'} !important;
          font-size: ${s.company_font_size ? `${s.company_font_size}px` : (s.logo_font_size || '20px')} !important;
          font-weight: ${s.company_font_weight || s.logo_font_weight || '800'} !important;
          color: ${s.company_font_color || s.logo_font_color || '#1e293b'} !important;
          letter-spacing: ${s.company_letter_spacing !== undefined ? `${s.company_letter_spacing}px` : (s.logo_letter_spacing || '-0.3px')} !important;
          transition: color 0.15s ease !important;
        }
        .${secClass} .brand-logo-text:hover { color: ${s.company_hover_color || s.logo_hover_color || s.company_font_color || s.logo_font_color || '#1e293b'} !important; }
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
            row.columns.forEach((col: any) => {
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
    compiled += `@media (max-width: 991px) {\n` + tabletRules + `}\n`;
  }
  if (mobileRules) {
    compiled += `@media (max-width: 767px) {\n` + mobileRules + `}\n`;
  }

  return compiled;
};

// ─── SVG Icon Library ───────────────────────────────────────────────────────
export const ICON_SVG_LIBRARY: Record<string, { label: string; svg: string }> = {
  Check: { label: 'Checkmark ✓', svg: '<polyline points="20 6 9 17 4 12"/>' },
  Star: { label: 'Star ★', svg: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>' },
  Heart: { label: 'Heart ❤️', svg: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>' },
  ArrowRight: { label: 'Arrow Right →', svg: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>' },
  ArrowLeft: { label: 'Arrow Left ←', svg: '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>' },
  ArrowUp: { label: 'Arrow Up ↑', svg: '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>' },
  ArrowDown: { label: 'Arrow Down ↓', svg: '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>' },
  Shield: { label: 'Shield 🛡️', svg: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>' },
  Lock: { label: 'Lock 🔒', svg: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>' },
  Zap: { label: 'Zap / Lightning ⚡', svg: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>' },
  Trophy: { label: 'Trophy / Award 🏆', svg: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/>' },
  Gift: { label: 'Gift 🎁', svg: '<polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>' },
  Flame: { label: 'Flame 🔥', svg: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 3.5z"/>' },
  Rocket: { label: 'Rocket 🚀', svg: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-3.05 11a22.35 22.35 0 0 1-3.95 2z"/><path d="M9 18l-4.5 4.5"/><path d="M15 9l4.5-4.5"/>' },
  User: { label: 'User / Profile 👤', svg: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>' },
  Mail: { label: 'Mail / Envelope ✉️', svg: '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>' },
  Phone: { label: 'Phone 📞', svg: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>' },
  Calendar: { label: 'Calendar 📅', svg: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>' },
  Globe: { label: 'Globe 🌐', svg: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>' },
  Search: { label: 'Search 🔍', svg: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>' },
  ShoppingBag: { label: 'Shopping Bag 🛍️', svg: '<path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>' },
  CreditCard: { label: 'Credit Card 💳', svg: '<rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>' },
  Play: { label: 'Play ▶️', svg: '<polygon points="5 3 19 12 5 21 5 3"/>' },
  Bell: { label: 'Bell 🔔', svg: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>' },
  Help: { label: 'Help / Question ❓', svg: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>' },
  Info: { label: 'Info ℹ️', svg: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>' },
  ThumbsUp: { label: 'Thumbs Up 👍', svg: '<path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>' },
  Sparkles: { label: 'Sparkles ✨', svg: '<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>' },
  Target: { label: 'Target 🎯', svg: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>' },
  Download: { label: 'Download 📥', svg: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>' }
};

export const renderSvgIcon = (name: string, size: number | string, color: string) => {
  const cleanName = (name || 'Check').trim();
  let foundKey = Object.keys(ICON_SVG_LIBRARY).find(k => k.toLowerCase() === cleanName.toLowerCase());
  if (!foundKey) {
    if (cleanName.toLowerCase() === 'arrow') foundKey = 'ArrowRight';
  }
  const item = foundKey ? ICON_SVG_LIBRARY[foundKey] : (ICON_SVG_LIBRARY[cleanName] || ICON_SVG_LIBRARY.Check);
  const sizePx = typeof size === 'number' ? `${size}px` : (/^\d+$/.test(String(size)) ? `${size}px` : String(size) || '24px');

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={sizePx}
      height={sizePx}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color || 'currentColor'}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: item.svg }}
      style={{ display: 'inline-block', verticalAlign: 'middle' }}
    />
  );
};

// ─── Social Links Renderer ──────────────────────────────────────────────────
export const SOCIAL_PLATFORMS_META: Record<string, { label: string; color: string; svg: string }> = {
  facebook: { label: 'Facebook', color: '#1877F2', svg: '<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>' },
  twitter: { label: 'Twitter / X', color: '#000000', svg: '<path d="M4 4l16 16M20 4L4 20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' },
  x: { label: 'Twitter / X', color: '#000000', svg: '<path d="M4 4l16 16M20 4L4 20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' },
  instagram: { label: 'Instagram', color: '#E1306C', svg: '<rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>' },
  linkedin: { label: 'LinkedIn', color: '#0A66C2', svg: '<path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/>' },
  youtube: { label: 'YouTube', color: '#FF0000', svg: '<path d="M22.54 6.42a2.78 2.78 0 0 0-1.95-1.96C18.88 4 12 4 12 4s-6.88 0-8.59.46a2.78 2.78 0 0 0-1.95 1.96A29 29 0 0 0 1 12a29 29 0 0 0 .46 5.58A2.78 2.78 0 0 0 3.41 19.6C5.12 20 12 20 12 20s6.88 0 8.59-.46a2.78 2.78 0 0 0 1.95-1.95A29 29 0 0 0 23 12a29 29 0 0 0-.46-5.58z"/><polygon points="9.75 15.02 15.5 12 9.75 8.98 9.75 15.02"/>' },
  whatsapp: { label: 'WhatsApp', color: '#25D366', svg: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>' },
  github: { label: 'GitHub', color: '#24292F', svg: '<path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>' },
  tiktok: { label: 'TikTok', color: '#000000', svg: '<path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5"/>' }
};

export const renderSocialLinksComponent = (cfg: any, key?: string) => {
  const platformsObj: Record<string, string> = cfg.platforms || {
    facebook: cfg.facebook || '',
    twitter: cfg.twitter || cfg.x || '',
    instagram: cfg.instagram || '',
    linkedin: cfg.linkedin || '',
    youtube: cfg.youtube || '',
    whatsapp: cfg.whatsapp || '',
    github: cfg.github || '',
    tiktok: cfg.tiktok || ''
  };

  let entries = Object.entries(platformsObj).filter(([, v]) => !!v && typeof v === 'string' && v.trim() !== '');
  if (!entries.length) {
    entries = [
      ['facebook', 'https://facebook.com'],
      ['twitter', 'https://twitter.com'],
      ['instagram', 'https://instagram.com'],
      ['linkedin', 'https://linkedin.com']
    ];
  }

  const align = cfg.align || cfg.alignment || 'center';
  const flexJustify = align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';

  const size = Number(cfg.size || cfg.icon_size || 40);
  const shape = cfg.shape || cfg.icon_shape || 'circle';
  const styleType = cfg.icon_style || (cfg.filled !== false ? (cfg.outlined ? 'outlined' : 'filled') : 'outlined');
  const displayMode = cfg.display_mode || 'icons';

  const borderRadius = shape === 'circle' ? '50%' : shape === 'rounded' ? `${Math.max(6, Math.round(size * 0.25))}px` : '0px';

  return (
    <div key={key} style={{ margin: cfg.margin || '16px 0', display: 'flex', gap: cfg.gap || '12px', justifyContent: flexJustify, flexWrap: 'wrap', alignItems: 'center' }}>
      {entries.map(([plat, url]) => {
        const meta = SOCIAL_PLATFORMS_META[plat.toLowerCase()] || { label: plat, color: '#6366F1', svg: '' };
        const brandColor = cfg.custom_color || meta.color;

        let bg = 'transparent';
        let color = brandColor;
        let border = 'none';

        if (styleType === 'filled') {
          bg = brandColor;
          color = '#ffffff';
          border = 'none';
        } else if (styleType === 'outlined') {
          bg = 'transparent';
          color = brandColor;
          border = `2px solid ${brandColor}`;
        } else if (styleType === 'flat') {
          bg = 'transparent';
          color = brandColor;
          border = 'none';
        }

        const iconDimension = Math.round(size * 0.52);
        const svgHtml = `<svg xmlns="http://www.w3.org/2000/svg" width="${iconDimension}" height="${iconDimension}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${meta.svg}</svg>`;

        if (displayMode === 'text_badges') {
          return (
            <a
              key={plat}
              href={url}
              target="_blank"
              rel="noreferrer"
              title={meta.label}
              style={{
                padding: '8px 16px',
                borderRadius: borderRadius === '50%' ? '20px' : borderRadius,
                fontSize: `${Math.max(11, Math.round(size * 0.32))}px`,
                fontWeight: 700,
                color,
                background: bg,
                border,
                textDecoration: 'none',
                transition: 'all 0.2s ease',
                display: 'inline-flex',
                alignItems: 'center'
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.8'; (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; (e.currentTarget as HTMLElement).style.transform = 'translateY(0)'; }}
            >
              {meta.label.split(' ')[0]}
            </a>
          );
        }

        if (displayMode === 'both') {
          return (
            <a
              key={plat}
              href={url}
              target="_blank"
              rel="noreferrer"
              title={meta.label}
              style={{
                padding: '8px 16px',
                borderRadius: borderRadius === '50%' ? '24px' : borderRadius,
                fontSize: `${Math.max(11, Math.round(size * 0.32))}px`,
                fontWeight: 700,
                color,
                background: bg,
                border,
                textDecoration: 'none',
                transition: 'all 0.2s ease',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px'
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.8'; (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; (e.currentTarget as HTMLElement).style.transform = 'translateY(0)'; }}
            >
              <span dangerouslySetInnerHTML={{ __html: svgHtml }} style={{ display: 'inline-flex' }} />
              <span>{meta.label.split(' ')[0]}</span>
            </a>
          );
        }

        return (
          <a
            key={plat}
            href={url}
            target="_blank"
            rel="noreferrer"
            title={meta.label}
            style={{
              width: `${size}px`,
              height: `${size}px`,
              borderRadius,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color,
              background: bg,
              border,
              transition: 'all 0.2s ease',
              textDecoration: 'none',
              boxSizing: 'border-box'
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.8'; (e.currentTarget as HTMLElement).style.transform = 'scale(1.1)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; }}
            dangerouslySetInnerHTML={{ __html: svgHtml }}
          />
        );
      })}
    </div>
  );
};

// ─── Countdown Timer & Sizing Helper ─────────────────────────────────────────
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

const CountdownTimer: React.FC<{
  targetDate: string;
  expiredMessage: string;
  format?: string;
  digitSize?: string;
  labelSize?: string;
  gap?: string;
  textColor?: string;
  align?: string;
}> = ({ targetDate, expiredMessage, format, digitSize = '32px', labelSize = '10px', gap = '16px', textColor = '#111827', align = 'center' }) => {
  const [timeLeft, setTimeLeft] = useState<{ d: number; h: number; m: number; s: number } | null>(null);
  const [isExpired, setIsExpired] = useState(false);

  useEffect(() => {
    if (!targetDate) return;
    const calculate = () => {
      const diff = +new Date(targetDate) - +new Date();
      if (diff <= 0) { setIsExpired(true); return; }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff / 3600000) % 24);
      const m = Math.floor((diff / 60000) % 60);
      const s = Math.floor((diff / 1000) % 60);
      setTimeLeft({ d, h, m, s });
      setIsExpired(false);
    };
    calculate();
    const id = setInterval(calculate, 1000);
    return () => clearInterval(id);
  }, [targetDate]);

  if (isExpired) return <span style={{ fontSize: '18px', color: '#EF4444', fontWeight: 700 }}>{expiredMessage || 'Offer expired!'}</span>;

  const d = timeLeft?.d ?? 0;
  const h = timeLeft?.h ?? 0;
  const m = timeLeft?.m ?? 0;
  const s = timeLeft?.s ?? 0;
  const pad = (n: number) => n.toString().padStart(2, '0');

  if (format === 'hms') {
    return <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 800, fontSize: digitSize, color: textColor, letterSpacing: '-0.5px' }}>{`${pad(h)}:${pad(m)}:${pad(s)}`}</span>;
  }
  if (format === 'ms') {
    return <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 800, fontSize: digitSize, color: textColor, letterSpacing: '-0.5px' }}>{`${pad(m)}:${pad(s)}`}</span>;
  }

  const flexJustify = align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';

  return (
    <div style={{ display: 'flex', gap, justifyContent: flexJustify, alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: digitSize, fontWeight: 800, lineHeight: 1.1, color: textColor }}>{pad(d)}</div>
        <div style={{ fontSize: labelSize, fontWeight: 600, opacity: 0.7, textTransform: 'uppercase', marginTop: '2px', color: textColor }}>DAYS</div>
      </div>
      <div style={{ fontSize: digitSize, fontWeight: 800, opacity: 0.4, lineHeight: 1.1, color: textColor }}>:</div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: digitSize, fontWeight: 800, lineHeight: 1.1, color: textColor }}>{pad(h)}</div>
        <div style={{ fontSize: labelSize, fontWeight: 600, opacity: 0.7, textTransform: 'uppercase', marginTop: '2px', color: textColor }}>HOURS</div>
      </div>
      <div style={{ fontSize: digitSize, fontWeight: 800, opacity: 0.4, lineHeight: 1.1, color: textColor }}>:</div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: digitSize, fontWeight: 800, lineHeight: 1.1, color: textColor }}>{pad(m)}</div>
        <div style={{ fontSize: labelSize, fontWeight: 600, opacity: 0.7, textTransform: 'uppercase', marginTop: '2px', color: textColor }}>MINS</div>
      </div>
      <div style={{ fontSize: digitSize, fontWeight: 800, opacity: 0.4, lineHeight: 1.1, color: textColor }}>:</div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: digitSize, fontWeight: 800, lineHeight: 1.1, color: textColor }}>{pad(s)}</div>
        <div style={{ fontSize: labelSize, fontWeight: 600, opacity: 0.7, textTransform: 'uppercase', marginTop: '2px', color: textColor }}>SECS</div>
      </div>
    </div>
  );
};

// ─── Embedded Form Component ────────────────────────────────────────────────
interface EmbeddedFormProps { formId: string; funnelId: string; stepId: string; onSubmitted: () => void; }

const EmbeddedForm: React.FC<EmbeddedFormProps> = ({ formId, funnelId, stepId, onSubmitted }) => {
  const [formMeta, setFormMeta] = useState<Form | null>(null);
  const [fields, setFields] = useState<FormField[]>([]);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const theme = getFormTheme(formId);

  useEffect(() => {
    if (!formId) return;
    fetch(`${BASE}/forms/public/${formId}`)
      .then(res => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then(f => {
        setFormMeta(f);
        return fetch(`${BASE}/forms/public/${formId}/fields`);
      })
      .then(res => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then(fieldsData => {
        setFields(fieldsData || []);
      })
      .catch(() => { });
  }, [formId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const sessionId = getOrCreateSessionId();
      const utms = getUtmParams();
      const responses = fields.map(f => ({ form_field_id: f.id, value: formData[f.id] || '' }));
      const resp = await fetch(`${BASE}/forms/${formId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ responses, visitor_id: sessionId, utm_source: utms.utm_source, metadata: { step_id: stepId, funnel_id: funnelId, url: window.location.href } }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail || 'Submission failed');
      }
      await trackEvent(funnelId, stepId, 'form_submit', true);
      onSubmitted();
    } catch (err: any) {
      setError(err.message || 'An error occurred. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!formMeta) return <p style={{ color: '#9CA3AF', fontSize: '14px', textAlign: 'center' }}>Loading form…</p>;

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px', width: '100%', boxSizing: 'border-box' }}>
      <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: 700, color: theme.labelColor, textAlign: 'center' }}>{formMeta.title}</h3>
      {fields.map(field => (
        <div key={field.id} style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%', boxSizing: 'border-box' }}>
          <label style={{ fontSize: theme.labelFontSize, fontWeight: theme.labelFontWeight as any, color: theme.labelColor }}>
            {field.label || field.name}{field.is_required && <span style={{ color: '#EF4444' }}> *</span>}
          </label>
          {field.field_type === 'textarea' ? (
            <textarea required={field.is_required} value={formData[field.id] || ''} onChange={e => setFormData(p => ({ ...p, [field.id]: e.target.value }))} style={{ padding: '10px 12px', border: `1.5px solid ${theme.inputBorderColor}`, borderRadius: theme.inputBorderRadius, fontSize: theme.inputFontSize, color: theme.inputTextColor, background: theme.inputBgColor, minHeight: '90px', outline: 'none', fontFamily: 'inherit', resize: 'vertical', width: '100%', boxSizing: 'border-box' }} />
          ) : (
            <input type={field.field_type === 'email' ? 'email' : field.field_type === 'phone' ? 'tel' : field.field_type === 'number' ? 'number' : 'text'} required={field.is_required} value={formData[field.id] || ''} onChange={e => setFormData(p => ({ ...p, [field.id]: e.target.value }))} style={{ padding: '10px 12px', border: `1.5px solid ${theme.inputBorderColor}`, borderRadius: theme.inputBorderRadius, fontSize: theme.inputFontSize, color: theme.inputTextColor, background: theme.inputBgColor, outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' }} />
          )}
        </div>
      ))}
      {error && <div style={{ padding: '10px 14px', background: '#FEE2E2', color: '#B91C1C', borderRadius: '8px', fontSize: '14px', width: '100%', boxSizing: 'border-box' }}>{error}</div>}
      <button type="submit" disabled={isSubmitting} style={{ padding: '12px 16px', background: isSubmitting ? '#9CA3AF' : theme.btnBgColor, color: theme.btnTextColor, border: 'none', borderRadius: theme.btnBorderRadius, fontSize: theme.btnFontSize, fontWeight: theme.btnFontWeight as any, cursor: isSubmitting ? 'not-allowed' : 'pointer', transition: 'all 0.2s ease', marginTop: '4px', width: '100%', boxSizing: 'border-box', boxShadow: '0 4px 12px rgba(0,0,0,0.12)' }}>
        {isSubmitting ? 'Submitting…' : (theme.submitText || 'Submit')}
      </button>
    </form>
  );
};

// ─── Preview Toolbar Styles ────────────────────────────────────────────────
const previewToolbarStyles = {
  container: { position: 'fixed' as const, top: 0, left: 0, right: 0, height: '50px', backgroundColor: '#ffffff', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 20px', zIndex: 1000, boxShadow: '0 2px 10px rgba(0,0,0,0.05)' },
  left: { display: 'flex', alignItems: 'center', gap: '10px' },
  title: { fontFamily: 'Inter, sans-serif', fontSize: '14px', fontWeight: 600, color: '#0f172a' },
  center: { display: 'flex', gap: '8px' },
  btn: { fontFamily: 'Inter, sans-serif', fontSize: '12px', fontWeight: 500, padding: '6px 12px', border: '1px solid #cbd5e1', borderRadius: '6px', backgroundColor: '#ffffff', color: '#475569', cursor: 'pointer', transition: 'all 0.2s' },
  activeBtn: { backgroundColor: '#6366F1', borderColor: '#6366F1', color: '#ffffff' },
  right: { display: 'flex', alignItems: 'center' },
  badge: { fontFamily: 'Inter, sans-serif', fontSize: '11px', fontWeight: 700, color: '#f59e0b', backgroundColor: '#fef3c7', padding: '4px 8px', borderRadius: '10px', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }
};

const pageStyles = {
  validationError: { padding: '12px', backgroundColor: '#FEF2F2', border: '1.5px dashed #EF4444', borderRadius: '8px', color: '#991B1B', fontSize: '13px', margin: '12px 0', textAlign: 'center' as const, fontWeight: 500 },
  emptyStateContainer: { padding: '60px 40px', textAlign: 'center' as const, color: '#64748B', backgroundColor: '#ffffff', border: '2px dashed #cbd5e1', borderRadius: '16px', maxWidth: '520px', margin: '40px auto', boxShadow: '0 10px 30px rgba(0,0,0,0.02)' },
  loadingWrap: { display: 'flex' as const, flexDirection: 'column' as const, alignItems: 'center' as const, justifyContent: 'center' as const, minHeight: '100vh', fontFamily: 'Inter, sans-serif' }
};

// ─── Navbar Renderer ────────────────────────────────────────────────────────
const NavbarRenderer: React.FC<{ section: any; isMobileDevice: boolean }> = ({ section, isMobileDevice }) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const s = section.settings || {};
  const links: { label: string; url: string }[] = s.links || [];
  const logoAlign = s.logo_align || 'left';

  const handleNavClick = (rawUrl: string) => {
    setMobileOpen(false);
    if (!rawUrl) return;
    const url = rawUrl.trim();
    const targetId = url.replace(/^#/, '').toLowerCase().trim();
    if (!targetId) return;

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
    } else {
      const fallback = document.getElementById(targetId) || document.getElementById(url.replace(/^#/, ''));
      if (fallback) {
        fallback.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('/')) {
        window.location.href = normalizeUrl(url);
      }
    }
  };

  const renderSocialIcon = (plat: string, url: string) => {
    if (!url) return null;
    const color = plat === 'facebook' ? '#1877F2' : plat === 'instagram' ? '#E1306C' : plat === 'linkedin' ? '#0A66C2' : '#000';
    return (
      <a href={url} target="_blank" rel="noreferrer" key={plat} style={{ color: '#475569', display: 'inline-flex', alignItems: 'center', transition: 'color 0.15s', textDecoration: 'none' }} onMouseEnter={e => (e.currentTarget.style.color = color)} onMouseLeave={e => (e.currentTarget.style.color = '#475569')}>
        <span style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase' }}>{plat === 'twitter' ? 'X' : plat.slice(0, 2).toUpperCase()}</span>
      </a>
    );
  };

  const renderLogo = () => {
    const logoVis = s.logo_visibility || 'all';
    if (logoVis === 'desktop' && isMobileDevice) return null;
    if (logoVis === 'mobile' && !isMobileDevice) return null;

    const logoImgStyle: React.CSSProperties = {
      width: s.logo_width ? `${s.logo_width}px` : 'auto',
      height: s.logo_height ? `${s.logo_height}px` : '36px',
      maxWidth: s.logo_max_width ? `${s.logo_max_width}px` : '100%',
      objectFit: (s.logo_object_fit as any) || 'contain',
      borderRadius: s.logo_border_radius ? `${s.logo_border_radius}px` : '0px',
      margin: s.logo_margin || '0px',
      padding: s.logo_padding || '0px'
    };

    const companyTextStyle: React.CSSProperties = {
      fontFamily: s.company_font_family || s.logo_font_family || 'inherit',
      fontSize: s.company_font_size ? `${s.company_font_size}px` : (s.logo_font_size || '20px'),
      fontWeight: s.company_font_weight || s.logo_font_weight || 800,
      fontStyle: (s.company_font_style as any) || 'normal',
      color: s.company_font_color || s.logo_font_color || '#1e293b',
      letterSpacing: s.company_letter_spacing ? `${s.company_letter_spacing}px` : (s.logo_letter_spacing || '-0.3px'),
      lineHeight: s.company_line_height || 1.2,
      textTransform: (s.company_text_transform as any) || 'none',
      textAlign: (s.company_text_align as any) || 'left',
      margin: s.company_margin || '0px',
      padding: s.company_padding || '0px',
      transition: 'color 0.15s ease'
    };

    const logoText = s.company_name || s.logo_text;

    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0, justifyContent: (!isMobileDevice && logoAlign === 'center') ? 'center' : 'flex-start' }}>
        {s.logo_url && (
          <img
            src={s.logo_url.startsWith('/static') ? `${BACKEND_URL}${s.logo_url}` : s.logo_url}
            alt="logo"
            style={logoImgStyle}
          />
        )}
        {logoText && (
          <span
            className="brand-logo-text"
            style={companyTextStyle}
            onMouseEnter={e => {
              const hColor = s.company_hover_color || s.logo_hover_color;
              if (hColor) e.currentTarget.style.color = hColor;
            }}
            onMouseLeave={e => {
              const fColor = s.company_font_color || s.logo_font_color || '#1e293b';
              e.currentTarget.style.color = fColor;
            }}
          >
            {logoText}
          </span>
        )}
      </div>
    );
  };

  const getNavAlignFlex = (align: string) => {
    switch (align) {
      case 'left': return 'flex-start';
      case 'center': return 'center';
      case 'right': return 'flex-end';
      case 'space-between': return 'space-between';
      case 'space-around': return 'space-around';
      case 'space-evenly': return 'space-evenly';
      default: return undefined;
    }
  };

  return (
    <nav style={{ width: '100%', boxSizing: 'border-box', padding: s.padding || '0 24px', display: 'flex', flexDirection: isMobileDevice ? 'row' : (logoAlign === 'center' ? 'column' : (logoAlign === 'right' ? 'row-reverse' : 'row')), gap: (!isMobileDevice && logoAlign === 'center') ? '12px' : '20px', alignItems: 'center', justifyContent: 'space-between', minHeight: '64px', fontFamily: 'inherit' }}>
      {((!isMobileDevice && logoAlign !== 'center') || isMobileDevice) && renderLogo()}
      {!isMobileDevice && logoAlign === 'center' && (
        <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>{renderLogo()}</div>
      )}
      {!isMobileDevice && (
        <div style={{ display: 'flex', flexDirection: logoAlign === 'right' ? 'row-reverse' : 'row', gap: '32px', alignItems: 'center', justifyContent: getNavAlignFlex(s.nav_align) || (logoAlign === 'center' ? 'center' : 'flex-end'), width: (logoAlign === 'center' || s.nav_align) ? '100%' : 'auto' }}>
          <div style={{ display: 'flex', gap: '28px', alignItems: 'center' }}>
            {links.map((link: any, i) => {
              const linkStyle: React.CSSProperties = {
                color: link.color || s.nav_color || '#475569',
                fontStyle: link.font_style || 'normal'
              };
              return (
                <button key={i} type="button" className="nav-item-link" style={linkStyle} onClick={() => handleNavClick(link.url)}>{link.label}</button>
              );
            })}
          </div>
          {s.social_links && Object.values(s.social_links).some(v => !!v) && (
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              {Object.entries(s.social_links).map(([k, v]) => renderSocialIcon(k, v as string))}
            </div>
          )}
          {s.cta_text && (
            <button type="button" className="nav-cta-btn" onClick={() => handleNavClick(s.cta_url || '#')}>{s.cta_text}</button>
          )}
        </div>
      )}
      {isMobileDevice && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {s.cta_text && <button type="button" className="nav-cta-btn" style={{ padding: '6px 14px', fontSize: '12px' }} onClick={() => handleNavClick(s.cta_url || '#')}>{s.cta_text}</button>}
          <button type="button" onClick={() => setMobileOpen(prev => !prev)} aria-label="Toggle navigation" style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: '8px', width: '40px', height: '40px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4px', cursor: 'pointer', padding: '8px' }}>
            {mobileOpen ? (
              <span style={{ fontSize: '20px', lineHeight: 1, color: '#475569' }}>&times;</span>
            ) : (
              <>
                <span style={{ width: '18px', height: '2px', background: '#475569', borderRadius: '2px' }} />
                <span style={{ width: '18px', height: '2px', background: '#475569', borderRadius: '2px' }} />
                <span style={{ width: '18px', height: '2px', background: '#475569', borderRadius: '2px' }} />
              </>
            )}
          </button>
        </div>
      )}
      {isMobileDevice && mobileOpen && (links.length > 0 || s.social_links) && (
        <div style={{ position: 'absolute', top: '64px', left: 0, right: 0, background: s.background_color || '#ffffff', borderBottom: '1px solid rgba(0,0,0,0.08)', padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: '16px', zIndex: 1000, boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
          {links.map((link: any, i: number) => {
            const linkStyle: React.CSSProperties = { textAlign: 'left', width: '100%' };
            if (link.color) linkStyle.color = link.color;
            if (link.font_style) linkStyle.fontStyle = link.font_style;
            return (
              <button key={i} type="button" className="nav-item-link" onClick={() => handleNavClick(link.url)} style={linkStyle}>{link.label}</button>
            );
          })}
          {s.social_links && Object.values(s.social_links).some(v => !!v) && (
            <div style={{ display: 'flex', gap: '16px', borderTop: '1px solid #f1f5f9', paddingTop: '12px' }}>
              {Object.entries(s.social_links).map(([k, v]) => renderSocialIcon(k, v as string))}
            </div>
          )}
        </div>
      )}
    </nav>
  );
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
const FooterRenderer: React.FC<{ section: any; isMobileDevice: boolean }> = ({ section, isMobileDevice }) => {
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

  const handleSubscribe = (colId: string) => {
    if (!emailInputs[colId] || !emailInputs[colId].includes('@')) return;
    setSubscribedCol(prev => ({ ...prev, [colId]: true }));
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
      overflow: 'hidden'
    }}>
      {/* Background Image / Overlay */}
      {s.footer_bg_image && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          backgroundImage: `url(${s.footer_bg_image})`,
          backgroundSize: 'cover', backgroundPosition: 'center', opacity: s.footer_bg_opacity ?? 0.15,
          pointerEvents: 'none'
        }} />
      )}

      <div style={{
        maxWidth: s.max_width || '1200px',
        margin: '0 auto',
        display: 'grid',
        gridTemplateColumns: isMobileDevice ? '1fr' : `repeat(${columnCount}, minmax(0, 1fr))`,
        gap: s.footer_gap || '40px',
        alignItems: 'start',
        marginBottom: '44px',
        position: 'relative',
        zIndex: 2
      }}>
        {columns.map((col: any, idx: number) => {
          const colId = col.id || `col_${idx}`;
          const colTitle = col.title;

          return (
            <div key={colId} style={{ display: 'flex', flexDirection: 'column', gap: '14px', flex: col.flex || '1' }}>
              {/* Heading */}
              {colTitle && col.type !== 'brand' && (
                <h4 style={{
                  margin: 0, fontSize: s.heading_font_size || '13px',
                  fontWeight: s.heading_font_weight || 700,
                  color: headingColor,
                  textTransform: (s.heading_transform as any) || 'uppercase',
                  letterSpacing: '0.08em'
                }}>
                  {colTitle}
                </h4>
              )}

              {/* Brand Column */}
              {col.type === 'brand' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {s.show_footer_logo && logoUrl ? (
                    <img src={logoUrl.startsWith('/static') ? `${BACKEND_URL}${logoUrl}` : logoUrl} alt="Logo" style={{ width: logoWidth, height: 'auto', objectFit: 'contain' }} />
                  ) : (
                    <h3 style={{ margin: 0, fontSize: '22px', fontWeight: 800, color: headingColor, letterSpacing: '-0.5px' }}>
                      {s.footer_company_name || s.footer_brand_title || colTitle || 'GrowthOS'}
                    </h3>
                  )}
                  {(s.footer_tagline || col.content?.tagline) && (
                    <p style={{ margin: 0, fontSize: '13px', color: textColor, lineHeight: 1.6 }}>
                      {s.footer_tagline || col.content.tagline}
                    </p>
                  )}
                </div>
              )}

              {/* Links Column (Quick Links, Resources, Products, Legal) */}
              {(col.type === 'links' || col.type === 'resources' || col.type === 'products' || col.type === 'legal') && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
                  {(col.links || []).map((link: any, lIdx: number) => (
                    <a key={lIdx} href={link.url || '#'} target={link.target || '_self'} style={{
                      color: link.color || linkColor,
                      fontSize: '13px',
                      textDecoration: 'none',
                      fontStyle: link.font_style || 'normal',
                      transition: 'all 0.15s ease'
                    }}
                      onMouseEnter={e => e.currentTarget.style.color = link.hover_color || linkHoverColor}
                      onMouseLeave={e => e.currentTarget.style.color = link.color || linkColor}>
                      {link.label}
                    </a>
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
                    {phone && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span>📞</span>
                        <span>{phone}</span>
                      </div>
                    )}
                    {email && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span>✉️</span>
                        <span>{email}</span>
                      </div>
                    )}
                    {address && (
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                        <span>📍</span>
                        <span>{address}</span>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Newsletter Column */}
              {col.type === 'newsletter' && (() => {
                const desc = s.footer_newsletter_desc || col.newsletter?.description;
                const placeholder = s.footer_newsletter_placeholder || col.newsletter?.placeholder;
                const btnText = s.footer_newsletter_btn_text || col.newsletter?.button_text || 'Subscribe';
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {desc && (
                      <p style={{ margin: 0, fontSize: '13px', color: textColor, lineHeight: 1.5 }}>
                        {desc}
                      </p>
                    )}
                    {subscribedCol[colId] ? (
                      <div style={{ padding: '10px 14px', borderRadius: '6px', background: 'rgba(34, 197, 94, 0.15)', border: '1px solid #22c55e', color: '#4ade80', fontSize: '13px', fontWeight: 600 }}>
                        ✓ {col.newsletter?.success_msg || 'Thank you for subscribing!'}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
                        <input
                          type="email"
                          placeholder={placeholder || 'Enter your email...'}
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
                          {btnText}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Social Links Column */}
              {col.type === 'social' && (() => {
                const currentObj = s.footer_socials || { facebook: '#', twitter: '#', linkedin: '#' };
                const socList = Array.isArray(s.social_links)
                  ? s.social_links
                  : Object.entries(currentObj).map(([platform, url]) => ({ platform, url, enabled: true }));
                return (
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    {socList.map((soc: any, sIdx: number) => {
                      if (soc.enabled === false) return null;
                      return (
                        <a key={sIdx} href={soc.url || '#'} target={soc.target || '_blank'} rel="noreferrer" style={{
                          width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(255,255,255,0.08)',
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          color: headingColor, textDecoration: 'none', transition: 'all 0.2s ease', border: '1px solid rgba(255,255,255,0.12)'
                        }}
                          onMouseEnter={e => { e.currentTarget.style.background = linkHoverColor; e.currentTarget.style.borderColor = linkHoverColor; }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; }}>
                          {renderFooterSocialSvg(soc.platform, headingColor, 16)}
                        </a>
                      );
                    })}
                  </div>
                );
              })()}

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
        <div>{copyright}</div>
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

// ─── Error Boundary Components ──────────────────────────────────────────────
class SectionErrorBoundary extends React.Component<
  { children: React.ReactNode; sectionId: string; sectionType: string },
  { hasError: boolean }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error(`[Section Error] Section ID: ${this.props.sectionId} (Type: ${this.props.sectionType}):`, error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '24px', margin: '16px auto', maxWidth: '1200px', border: '1.5px dashed #EF4444', borderRadius: '12px', background: '#FEF2F2', color: '#991B1B', fontSize: '14px', fontWeight: 600, textAlign: 'center' }}>
          ⚠️ Failed to render section: {this.props.sectionType} ({this.props.sectionId})
        </div>
      );
    }
    return this.props.children;
  }
}

class ComponentErrorBoundary extends React.Component<
  { children: React.ReactNode; compId: string; compType: string },
  { hasError: boolean }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error(`[Component Error] Component ID: ${this.props.compId} (Type: ${this.props.compType}):`, error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '12px', margin: '8px 0', border: '1px dashed #EF4444', borderRadius: '8px', background: '#FEF2F2', color: '#991B1B', fontSize: '13px', fontWeight: 500 }}>
          ⚠️ Failed to render component: {this.props.compType}
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Main Public Funnel Page ─────────────────────────────────────────────────
export const PublicFunnelPage: React.FC<PublicFunnelPageProps> = ({ funnelId }) => {
  const isPreview = new URLSearchParams(window.location.search).get('preview') === 'true';
  const [funnel, setFunnel] = useState<Funnel | null>(null);
  const [steps, setSteps] = useState<FunnelStep[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formSubmitted, setFormSubmitted] = useState(false);
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');

  const [bookingTime, setBookingTime] = useState<string>('');
  const [bookingName, setBookingName] = useState('');
  const [bookingEmail, setBookingEmail] = useState('');
  const [bookingPhone, setBookingPhone] = useState('');
  const [bookingSubmitting, setBookingSubmitting] = useState(false);
  const [bookingStatusMsg, setBookingStatusMsg] = useState('');
  const [bookingIsSuccess, setBookingIsSuccess] = useState(false);

  const isMobileDevice = previewDevice === 'mobile' || previewDevice === 'tablet' || window.innerWidth <= 768;

  const cleanFunnelProp = (funnelId || '').split('?')[0];
  const rawParts = cleanFunnelProp ? cleanFunnelProp.split('/').filter(Boolean) : [];
  let actualFunnelId = (rawParts[0] || '').trim();
  let targetStepId = (rawParts[1] || '').trim();

  if (actualFunnelId === 'step' && rawParts[1]) {
    actualFunnelId = rawParts[1];
    targetStepId = rawParts[2] || '';
  } else if (rawParts[1] === 'step' && rawParts[2]) {
    targetStepId = rawParts[2];
  }

  useEffect(() => {
    const load = async () => {
      if (!actualFunnelId) {
        setError('Funnel ID missing');
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const resp = await fetch(`${BASE}/funnels/public/${actualFunnelId}?preview=${isPreview}`);
        if (!resp.ok) {
          let diagnostic = 'Preview data unavailable';
          if (resp.status === 404) {
            try {
              const errData = await resp.json();
              diagnostic = errData.detail || 'Funnel not found';
            } catch {
              diagnostic = 'Funnel not found';
            }
          } else if (resp.status === 403) {
            diagnostic = 'Permission denied';
          } else if (resp.status === 401) {
            diagnostic = 'Invalid preview token';
          }
          throw new Error(diagnostic);
        }
        const data = await resp.json();
        setFunnel(data);
        const stepsList = [...(data.steps || [])].sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0));
        setSteps(stepsList);
        if (stepsList.length === 0) {
          throw new Error('Page not found');
        }
        if (targetStepId) {
          const cleanTarget = targetStepId.toLowerCase().trim();
          const idx = stepsList.findIndex((s: any) => {
            const sid = (s.id || '').toLowerCase();
            const sname = (s.name || '').toLowerCase().trim();
            const stype = (s.step_type || '').toLowerCase().trim();
            const sslug = (s.slug || '').toLowerCase().trim();
            return (
              sid === cleanTarget ||
              sname === cleanTarget ||
              stype === cleanTarget ||
              sslug === cleanTarget
            );
          });
          if (idx !== -1) {
            setCurrentStepIndex(idx);
          } else {
            setCurrentStepIndex(0);
          }
        } else {
          setCurrentStepIndex(0);
        }

      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [actualFunnelId, targetStepId, isPreview]);

  useEffect(() => {
    if (steps.length > 0 && steps[currentStepIndex]) {
      const step = steps[currentStepIndex];
      trackEvent(actualFunnelId, step.id, 'page_view');
    }
  }, [currentStepIndex, steps, actualFunnelId]);

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => { if (entry.isIntersecting) entry.target.classList.add('visible'); });
    }, { threshold: 0.1 });
    document.querySelectorAll('.animated_section.has_animation').forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, [currentStepIndex, steps]);

  const handleActionClick = useCallback(async (actionType: string, actionValue?: string) => {
    const step = steps[currentStepIndex];
    const at = (actionType || '').toLowerCase().trim();
    const av = (actionValue || '').trim();

    // 1. If target value is a URL (e.g. www.google.com, https://google.com, http://...) OR actionType is open_external_url/external_url/url
    if (at === 'open_external_url' || at === 'external_url' || at === 'url' || (av && (av.startsWith('http://') || av.startsWith('https://') || av.startsWith('www.') || (av.includes('.') && !av.startsWith('#') && !av.startsWith('/'))))) {
      const finalUrl = normalizeUrl(av);
      if (finalUrl) {
        window.open(finalUrl, '_blank', 'noopener,noreferrer');
        return;
      }
    }

    // 2. Scroll to section anchor
    if (at === 'scroll_to_section' || at === 'scroll') {
      if (av) {
        const targetId = av.replace(/^#/, '').toLowerCase().trim();
        const elements = Array.from(document.querySelectorAll('section, [id], [data-anchor]'));
        let foundEl: HTMLElement | null = null;
        for (const el of elements) {
          const elId = (el.getAttribute('id') || '').toLowerCase().trim();
          const elAnchor = (el.getAttribute('data-anchor') || '').toLowerCase().trim();
          const elName = (el.getAttribute('data-section-name') || '').toLowerCase().trim();
          const elType = (el.getAttribute('data-section-type') || '').toLowerCase().trim();
          if (elId === targetId || elAnchor === targetId || elType === targetId || elName === targetId || elName === `${targetId} section`) {
            foundEl = el as HTMLElement;
            break;
          }
        }
        if (foundEl) {
          foundEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
          const fallback = document.getElementById(targetId) || document.getElementById(av.replace(/^#/, ''));
          if (fallback) fallback.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
      return;
    }

    // 3. Specific step navigation
    if (at === 'go_to_specific_step') {
      if (av) {
        const idx = steps.findIndex(s => s.id === av || s.name.toLowerCase() === av.toLowerCase());
        if (idx !== -1) {
          setCurrentStepIndex(idx);
          setFormSubmitted(false);
          return;
        }
      }
    }

    // 4. Download file
    if (at === 'download_file' || at === 'download') {
      if (av) {
        const a = document.createElement('a');
        a.href = normalizeUrl(av);
        a.download = '';
        a.click();
      }
      return;
    }

    // 5. Email & Phone
    if (at === 'email') {
      if (av) window.location.href = `mailto:${av}`;
      return;
    }
    if (at === 'phone') {
      if (av) window.location.href = `tel:${av}`;
      return;
    }

    // Default fallback: Go to next step
    if (step && currentStepIndex < steps.length - 1) {
      await trackEvent(actualFunnelId, step.id, 'step_complete', true);
      setCurrentStepIndex(i => i + 1);
      setFormSubmitted(false);
    }
  }, [currentStepIndex, steps, actualFunnelId]);

  const handleFormSubmitted = useCallback(async (redirectUrl?: string) => {
    const step = steps[currentStepIndex];
    if (!step) return;
    setFormSubmitted(true);
    await trackEvent(actualFunnelId, step.id, 'form_submit', true);
    setTimeout(() => {
      if (redirectUrl && redirectUrl.trim() !== '') {
        const url = redirectUrl.trim();
        if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('www.')) {
          window.location.href = url.startsWith('www.') ? 'https://' + url : url;
        } else {
          window.location.href = url;
        }
      } else {
        if (currentStepIndex < steps.length - 1) {
          setCurrentStepIndex(i => i + 1);
          setFormSubmitted(false);
        }
      }
    }, 1500);
  }, [currentStepIndex, steps, actualFunnelId]);

  if (loading) {
    return (
      <div style={pageStyles.loadingWrap}>
        <div style={{ width: '48px', height: '48px', border: '4px solid #E5E7EB', borderTopColor: '#6366F1', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <p style={{ color: '#94a3b8', marginTop: '16px', fontSize: '14px' }}>Loading your experience…</p>
      </div>
    );
  }

  if (error || !funnel) {
    const errorHeading = error === 'Funnel ID missing' ? 'Funnel ID Missing'
      : error === 'Page not found' ? 'Page Not Found'
        : error === 'Invalid preview token' ? 'Invalid Preview Token'
          : error === 'Preview data unavailable' ? 'Preview Data Unavailable'
            : error === 'Permission denied' ? 'Permission Denied'
              : error === 'Draft not found' ? 'Draft Not Found'
                : 'Funnel Not Found';
    return (
      <div style={pageStyles.loadingWrap}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>😕</div>
        <h2 style={{ color: '#1e293b', margin: '0 0 8px 0', fontFamily: 'Inter, sans-serif' }}>{errorHeading}</h2>
        <p style={{ color: '#64748b', fontSize: '14px' }}>{error || 'This funnel may have been removed or is unavailable.'}</p>
      </div>
    );
  }

  const step = steps[currentStepIndex] || steps[0];
  if (!step) {
    return (
      <div style={{ padding: '80px 20px', textAlign: 'center', color: '#475569', fontFamily: "'Inter', sans-serif" }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>📄</div>
        <h2 style={{ fontSize: '22px', fontWeight: 700, color: '#1e293b' }}>Funnel Step Unavailable</h2>
        <p style={{ fontSize: '14px', color: '#64748b' }}>No active step content was found for this funnel page.</p>
      </div>
    );
  }

  const progressPct = steps.length > 1 ? Math.round(((currentStepIndex + 1) / steps.length) * 100) : 100;

  let parsedLayout: any = null;
  try {
    const layoutStr = step.page_content || step.layout;
    if (layoutStr) {
      parsedLayout = typeof layoutStr === 'string' ? JSON.parse(layoutStr) : layoutStr;
    }
  } catch (err) {
    console.error("Failed to parse layout from page_content/layout:", err);
  }

  if (!parsedLayout || !parsedLayout.sections || parsedLayout.sections.length === 0) {
    const sName = (step.name || '').toLowerCase();
    const makeId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    
    if (sName.includes('checkout') || sName.includes('order') || sName.includes('payment')) {
      parsedLayout = {
        sections: [{
          id: makeId('sec'),
          name: 'Checkout Section',
          type: 'Checkout',
          settings: { padding: '50px 0', background_color: '#F8FAFC', container_width: 'container', visibility: 'both' },
          rows: [{
            id: makeId('row'),
            settings: {},
            columns: [{
              id: makeId('col'),
              width: '100%',
              settings: {},
              components: [
                { id: makeId('comp'), type: 'Heading', config: JSON.stringify({ text: step.name || 'Complete Your Order', level: 'h1', align: 'center', color: '#1E293B' }) },
                { id: makeId('comp'), type: 'Paragraph', config: JSON.stringify({ text: 'Fill in your billing details below to finalize your order securely.', align: 'center', color: '#64748B' }) },
                { id: makeId('comp'), type: 'Checkout', config: JSON.stringify({ title: 'Order Details & Payment', button_text: 'Complete Order Now →' }) }
              ]
            }]
          }]
        }]
      };
    } else if (sName.includes('thank') || sName.includes('confirm')) {
      parsedLayout = {
        sections: [{
          id: makeId('sec'),
          name: 'Confirmation Section',
          type: 'ThankYou',
          settings: { padding: '60px 0', background_color: '#FFFFFF', container_width: 'container', visibility: 'both' },
          rows: [{
            id: makeId('row'),
            settings: {},
            columns: [{
              id: makeId('col'),
              width: '100%',
              settings: {},
              components: [
                { id: makeId('comp'), type: 'Heading', config: JSON.stringify({ text: 'Thank You! Your Order is Confirmed 🎉', level: 'h1', align: 'center', color: '#10B981' }) },
                { id: makeId('comp'), type: 'Paragraph', config: JSON.stringify({ text: 'We have received your request and sent a confirmation receipt to your email.', align: 'center', color: '#475569' }) },
                { id: makeId('comp'), type: 'Button', config: JSON.stringify({ text: 'Return to Dashboard', size: 'medium', alignment: 'center', color: '#4F46E5', text_color: '#FFFFFF' }) }
              ]
            }]
          }]
        }]
      };
    } else {
      parsedLayout = {
        sections: [{
          id: makeId('sec'),
          name: 'Hero Section',
          type: 'Hero',
          settings: { padding: '60px 0', background_color: '#FFFFFF', container_width: 'container', visibility: 'both' },
          rows: [{
            id: makeId('row'),
            settings: {},
            columns: [{
              id: makeId('col'),
              width: '100%',
              settings: {},
              components: [
                { id: makeId('comp'), type: 'Heading', config: JSON.stringify({ text: step.name || 'Welcome', level: 'h1', align: 'center', color: '#1E293B' }) },
                { id: makeId('comp'), type: 'Paragraph', config: JSON.stringify({ text: step.subheader_text || 'Experience seamless growth with our high-converting funnel page.', align: 'center', color: '#475569' }) },
                { id: makeId('comp'), type: 'Button', config: JSON.stringify({ text: step.button_text || 'Continue →', size: 'medium', alignment: 'center', color: '#4F46E5', text_color: '#FFFFFF' }) }
              ]
            }]
          }]
        }]
      };
    }
  }

  const sectionsList = parsedLayout?.sections || [];
  console.log("[Render Status] currentStep details:", {
    step_id: step.id,
    step_name: step.name,
    has_layout: !!parsedLayout,
    sections_count: sectionsList.length,
  });

  const bgColor = parsedLayout?.globalSettings?.background_color || funnel.settings?.background_color || '#ffffff';
  const compiledCss = parsedLayout ? compilePageStyles(parsedLayout) : '';

  // ─── Component Renderer ──────────────────────────────────────────────────
  const renderComponent = (comp: any, colIdx: number, rowIdx: number, secIdx: number): React.ReactNode => {
    if (!comp || !comp.type) return null;
    console.log(`[Component Render] ID: ${comp.id}, Type: ${comp.type}`);
    let cfg: any = {};
    try { cfg = typeof comp.config === 'string' ? JSON.parse(comp.config || '{}') : (comp.config || {}); } catch { }
    const key = `${secIdx}-${rowIdx}-${colIdx}-${comp.id}`;

    switch (comp.type) {
      case 'Heading': {
        const headingElement = React.createElement(cfg.level || cfg.tag || 'h2', { style: { fontSize: 'inherit', fontWeight: 'inherit', color: 'inherit', lineHeight: 'inherit', letterSpacing: 'inherit', fontFamily: 'inherit', textTransform: 'inherit', margin: 0, padding: 0 } }, cfg.text || 'Heading');
        return (
          <div key={key} className={`comp-${comp.id}`} style={{ margin: cfg.margin || '0 0 16px 0', textAlign: (cfg.align || cfg.alignment || 'left') as any }}>
            {wrapTextWithLink(headingElement, cfg)}
          </div>
        );
      }

      case 'Paragraph': {
        const paraContent = cfg.text || '';
        return (
          <div key={key} className={`comp-${comp.id}`} style={{ margin: cfg.margin || '0 0 20px 0', textAlign: (cfg.align || cfg.alignment || 'left') as any, fontSize: cfg.font_size || '18px', fontWeight: cfg.font_weight || 400, color: cfg.color || '#4b5563', lineHeight: cfg.line_height || '1.7', fontFamily: cfg.font_family || 'inherit', maxWidth: cfg.max_width || 'none', whiteSpace: 'pre-wrap' }}>
            {wrapTextWithLink(paraContent, cfg)}
          </div>
        );
      }

      case 'Text': {
        const textContent = <span dangerouslySetInnerHTML={{ __html: cfg.content || cfg.text || '' }} />;
        return (
          <div key={key} className={`comp-${comp.id}`} style={{ margin: cfg.margin || '0 0 16px 0', textAlign: (cfg.align || cfg.alignment || 'left') as any, fontSize: cfg.font_size || '16px', fontWeight: cfg.font_weight || 400, color: cfg.color || '#334155', lineHeight: cfg.line_height || '1.6', fontFamily: cfg.font_family || 'inherit' }}>
            {wrapTextWithLink(textContent, cfg)}
          </div>
        );
      }

      case 'Button': {
        const btnColor = cfg.color || '#6366F1';
        const btnStyle: React.CSSProperties = {
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
          padding: cfg.size === 'sm' ? '8px 16px' : cfg.size === 'lg' ? '16px 32px' : '12px 24px',
          fontSize: cfg.size === 'sm' ? '13px' : cfg.size === 'lg' ? '17px' : '15px',
          fontWeight: 700, borderRadius: cfg.border_radius || '10px',
          background: cfg.filled !== false ? btnColor : 'transparent',
          color: cfg.filled !== false ? '#fff' : btnColor,
          border: cfg.outlined ? `2px solid ${btnColor}` : 'none',
          cursor: 'pointer', transition: 'opacity 0.15s, transform 0.15s',
          boxShadow: cfg.filled !== false ? `0 4px 14px ${btnColor}55` : 'none',
          width: cfg.full_width ? '100%' : 'auto',
          textDecoration: 'none', fontFamily: cfg.font_family || 'inherit',
        };
        const handleBtnClick = () => {
          const av = cfg.action_value || cfg.url || cfg.destination_url || cfg.link || cfg.link_url || '';
          let at = cfg.action_type;
          if (!at) {
            at = (av && (av.startsWith('http') || av.startsWith('www.') || av.includes('.'))) ? 'open_external_url' : 'go_to_next_step';
          }
          handleActionClick(at, av);
        };
        return (
          <div key={key} className={`comp-${comp.id}`} style={{ margin: cfg.margin || '16px 0', textAlign: (cfg.alignment || cfg.align || 'center') as any }}>
            <button type="button" style={btnStyle} onClick={handleBtnClick}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.85'; (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; (e.currentTarget as HTMLElement).style.transform = 'translateY(0)'; }}>
              {cfg.icon && <span>{cfg.icon}</span>}
              {cfg.text || cfg.label || 'Click Here'}
            </button>
          </div>
        );
      }

      case 'Image': {
        const imgSrc = cfg.url || cfg.src || '';
        const fullSrc = imgSrc.startsWith('/static/') ? `${BACKEND_URL}${imgSrc}` : imgSrc;
        return (
          <div key={key} className={`comp-${comp.id}`} style={{ margin: cfg.margin || '0 0 16px 0', textAlign: (cfg.alignment || cfg.align || 'center') as any }}>
            {fullSrc ? (
              <img src={fullSrc} alt={cfg.alt || ''} style={{ maxWidth: cfg.max_width || '100%', width: cfg.width || 'auto', height: cfg.height || 'auto', borderRadius: cfg.border_radius || '0', objectFit: (cfg.object_fit as any) || 'contain', display: 'block', margin: '0 auto', boxShadow: cfg.shadow || 'none' }} />
            ) : (
              <div style={{ background: '#f1f5f9', borderRadius: '8px', padding: '40px', color: '#94a3b8', fontSize: '14px' }}>No image selected</div>
            )}
            {cfg.caption && <p style={{ color: '#64748b', fontSize: '12px', marginTop: '8px' }}>{cfg.caption}</p>}
          </div>
        );
      }

      case 'Video': {
        const parsed = parseVideoUrl(cfg.url || '');
        return (
          <div key={key} className={`comp-${comp.id}`} style={{ margin: cfg.margin || '0 0 16px 0', borderRadius: cfg.border_radius || '12px', overflow: 'hidden', boxShadow: cfg.shadow || '0 4px 20px rgba(0,0,0,0.08)' }}>
            {parsed.provider === 'youtube' && (
              <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0, overflow: 'hidden' }}>
                <iframe src={`https://www.youtube.com/embed/${parsed.id}?autoplay=${(cfg.autoplay || cfg.auto_play) ? 1 : 0}&mute=${(cfg.muted || cfg.mute) ? 1 : 0}&loop=${cfg.loop ? 1 : 0}&rel=0`} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }} allowFullScreen allow="autoplay; encrypted-media" />
              </div>
            )}
            {parsed.provider === 'vimeo' && (
              <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0, overflow: 'hidden' }}>
                <iframe src={`https://player.vimeo.com/video/${parsed.id}?autoplay=${(cfg.autoplay || cfg.auto_play) ? 1 : 0}&muted=${(cfg.muted || cfg.mute) ? 1 : 0}&loop=${cfg.loop ? 1 : 0}`} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }} allowFullScreen allow="autoplay; fullscreen" />
              </div>
            )}
            {parsed.provider === 'html5' && (
              <video src={parsed.id.startsWith('/static') ? `${BACKEND_URL}${parsed.id}` : parsed.id} autoPlay={cfg.autoplay || cfg.auto_play} muted={cfg.muted || cfg.mute} loop={cfg.loop} controls={!(cfg.autoplay || cfg.auto_play)} style={{ width: '100%', display: 'block' }} />
            )}
            {(parsed.provider === 'unknown' || parsed.provider === 'none') && (
              <div style={{ background: '#f1f5f9', padding: '40px', textAlign: 'center', color: '#94a3b8', fontSize: '14px' }}>
                {cfg.url ? '⚠️ Unsupported video URL format' : 'No video URL set'}
              </div>
            )}
          </div>
        );
      }

      case 'Divider': {
        const rawThick = String(cfg.thickness ?? '1px').trim();
        const cleanThick = rawThick.endsWith('pxpx')
          ? rawThick.replace('pxpx', 'px')
          : (rawThick.endsWith('px') ? rawThick : (/^\d+$/.test(rawThick) ? `${rawThick}px` : rawThick || '1px'));
        const marginVal = cfg.margin || '24px 0';
        const colorVal = cfg.color || '#e2e8f0';
        const widthVal = cfg.width || '100%';
        return (
          <div key={key} className={`comp-${comp.id}`} style={{ margin: marginVal, width: '100%', display: 'flex', justifyContent: 'center' }}>
            <hr style={{ border: 'none', borderTop: `${cleanThick} solid ${colorVal}`, width: widthVal, margin: '0 auto', padding: 0 }} />
          </div>
        );
      }

      case 'Spacer': {
        const rawH = String(cfg.height ?? '24px').trim();
        const cleanH = rawH.endsWith('pxpx')
          ? rawH.replace('pxpx', 'px')
          : (rawH.endsWith('px') ? rawH : (/^\d+$/.test(rawH) ? `${rawH}px` : rawH || '24px'));
        return (
          <div key={key} className={`comp-${comp.id}`} style={{ height: cleanH, minHeight: cleanH, width: '100%', flexShrink: 0 }} />
        );
      }

      case 'Countdown': {
        const { align, containerFlexJustify, boxPadding, digitFontSize, labelFontSize, gapSize, maxWidthVal } = getCountdownStyles(cfg, isMobileDevice);
        const bgColor = cfg.bg_color || cfg.background_color || cfg.background || '#f8fafc';
        const textColor = cfg.text_color || cfg.color || '#111827';
        const borderRadius = cfg.border_radius || '16px';
        const marginVal = cfg.margin || '16px 0';

        return (
          <div key={key} className={`comp-${comp.id}`} style={{ margin: marginVal, width: '100%', display: 'flex', justifyContent: containerFlexJustify }}>
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
              {cfg.label && <p style={{ fontSize: '14px', color: textColor, opacity: 0.85, marginBottom: '12px', fontWeight: 600, margin: '0 0 12px 0' }}>{cfg.label}</p>}
              <CountdownTimer
                targetDate={cfg.target_date}
                expiredMessage={cfg.expired_message || 'Offer expired!'}
                format={cfg.format || 'days_hours_minutes_seconds'}
                digitSize={digitFontSize}
                labelSize={labelFontSize}
                gap={gapSize}
                textColor={textColor}
                align={align}
              />
            </div>
          </div>
        );
      }

      case 'Form': return (
        <div key={key} className={`comp-${comp.id}`} style={{ margin: cfg.margin || '24px 0', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '24px', background: '#ffffff', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}>
          {cfg.form_id ? (
            <EmbeddedForm formId={cfg.form_id} funnelId={actualFunnelId} stepId={step.id} onSubmitted={() => handleFormSubmitted(cfg.redirect_url)} />
          ) : (
            <div style={{ textAlign: 'center', color: '#94a3b8' }}>No active Form.</div>
          )}
        </div>
      );

      case 'Testimonials': {
        const testimonials: any[] = cfg.testimonials || cfg.items || [];
        if (!testimonials.length) return <div key={key} style={{ textAlign: 'center', color: '#94a3b8', padding: '20px' }}>No testimonials configured.</div>;
        return (
          <div key={key} className={`comp-${comp.id}`} style={{ margin: cfg.margin || '16px 0', display: 'grid', gridTemplateColumns: isMobileDevice ? '1fr' : (testimonials.length === 1 ? '1fr' : 'repeat(auto-fill, minmax(280px, 1fr))'), gap: '20px' }}>
            {testimonials.map((t: any, i: number) => {
              const quote = t.quote || t.content || '';
              const name = t.name || t.author || '';
              const photo = t.photo || t.avatar_url || '';
              const role = t.designation || t.company || t.role || '';
              return (
                <div key={i} style={{ background: '#f8fafc', borderRadius: '16px', padding: '24px', border: '1px solid #e2e8f0' }}>
                  <div style={{ display: 'flex', gap: '4px', marginBottom: '12px' }}>
                    {[1, 2, 3, 4, 5].map(star => <span key={star} style={{ color: star <= (t.rating || 5) ? '#F59E0B' : '#D1D5DB', fontSize: '18px' }}>★</span>)}
                  </div>
                  <p style={{ color: '#334155', fontSize: '15px', lineHeight: '1.6', margin: '0 0 16px 0', fontStyle: 'italic' }}>"{quote}"</p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    {photo ? <img src={photo.startsWith('/static') ? `${BACKEND_URL}${photo}` : photo} alt={name} style={{ width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover' }} /> : <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: '#6366F1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: '16px' }}>{(name || '?')[0]}</div>}
                    <div>
                      <p style={{ margin: 0, fontWeight: 700, color: '#1e293b', fontSize: '14px' }}>{name}</p>
                      {role && <p style={{ margin: 0, color: '#64748b', fontSize: '12px' }}>{role}</p>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        );
      }

      case 'FAQ': {
        const faqs: any[] = cfg.faqs || cfg.items || [];
        if (!faqs.length) return <div key={key} style={{ textAlign: 'center', color: '#94a3b8', padding: '20px' }}>No FAQ items configured.</div>;
        return (
          <div key={key} className={`comp-${comp.id}`} style={{ margin: cfg.margin || '16px 0', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {faqs.map((faq: any, i: number) => (
              <details key={i} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px 20px', cursor: 'pointer', transition: 'all 0.2s' }}>
                <summary style={{ fontWeight: 600, color: '#1e293b', listStyle: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>{faq.question}</span>
                  <span style={{ fontSize: '16px', color: '#6366F1' }}>&#9662;</span>
                </summary>
                <p style={{ margin: '10px 0 0 0', color: '#4B5563', fontSize: '14px', lineHeight: 1.6, borderTop: '1px solid #f1f5f9', paddingTop: '8px', whiteSpace: 'pre-wrap' }}>{faq.answer}</p>
              </details>
            ))}
          </div>
        );
      }

      case 'SocialLinks': return renderSocialLinksComponent(cfg, key);

      case 'Calendar': {
        return (
          <div key={key} className={`comp-${comp.id}`}>
            <GoogleCalendarWidget
              config={cfg}
              isPreview={isPreview}
            />
          </div>
        );
      }

      case 'CustomHTML': return (
        <div key={key} className={`comp-${comp.id}`} dangerouslySetInnerHTML={{ __html: cfg.code || '' }} />
      );

      case 'Icons': {
        const align = cfg.alignment || cfg.align || 'center';
        const flexJustify = align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';
        return (
          <div key={key} className={`comp-${comp.id}`} style={{ margin: cfg.margin || '16px 0', display: 'flex', justifyContent: flexJustify, width: '100%' }}>
            {renderSvgIcon(cfg.icon_name || 'Check', cfg.size || 24, cfg.color || '#6366F1')}
          </div>
        );
      }

      case 'Checkout':
      case 'CheckoutForm':
      case 'OrderForm':
      case 'Payment':
      case 'PaymentForm': {
        return (
          <div key={key} className={`comp-${comp.id}`} style={{ margin: cfg.margin || '24px 0', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '28px', background: '#ffffff', boxShadow: '0 4px 16px rgba(0,0,0,0.04)', maxWidth: cfg.max_width || '540px', marginLeft: 'auto', marginRight: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', borderBottom: '1px solid #f1f5f9', paddingBottom: '12px' }}>
              <span style={{ fontSize: '20px' }}>💳</span>
              <h3 style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: '#1e293b' }}>
                {cfg.title || cfg.heading || 'Checkout & Order Summary'}
              </h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '20px' }}>
              <div>
                <label style={{ fontSize: '12.5px', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '4px' }}>Customer Name *</label>
                <input type="text" placeholder="John Doe" style={{ width: '100%', padding: '10px 14px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: '12.5px', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '4px' }}>Email Address *</label>
                <input type="email" placeholder="john@example.com" style={{ width: '100%', padding: '10px 14px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: '12.5px', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '4px' }}>Payment Method *</label>
                <div style={{ padding: '14px', border: '1px solid #cbd5e1', borderRadius: '8px', background: '#f8fafc', fontSize: '13.5px', color: '#334155', fontWeight: 500 }}>
                  🔒 Secure Stripe / Credit Card Checkout
                </div>
              </div>
            </div>
            <button
              type="button"
              style={{
                width: '100%', padding: '14px', background: cfg.button_color || '#10B981', color: '#ffffff',
                border: 'none', borderRadius: '10px', fontSize: '16px', fontWeight: 700, cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(16, 185, 129, 0.3)', transition: 'background 0.2s'
              }}
              onClick={() => handleActionClick('go_to_next_step')}
            >
              {cfg.button_text || 'Complete Order Now →'}
            </button>
          </div>
        );
      }

      default:
        return null;
    }
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: isPreview ? '#f1f5f9' : bgColor, fontFamily: "'Inter', 'Segoe UI', sans-serif", transition: 'background-color 0.4s ease', padding: isPreview ? '60px 0 20px 0' : 0 }}>
      <style dangerouslySetInnerHTML={{
        __html: `
        .animated_section.visible { opacity: 1 !important; transform: none !important; }
        ${compiledCss}
      ` }} />
      {!isPreview && (
        <div style={{ height: '4px', background: '#E5E7EB', position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100 }}>
          <div style={{ height: '100%', width: `${progressPct}%`, background: 'linear-gradient(90deg, #6366F1, #8B5CF6)', transition: 'width 0.5s ease' }} />
        </div>
      )}
      {isPreview && (
        <div style={previewToolbarStyles.container}>
          <div style={previewToolbarStyles.left}><span style={previewToolbarStyles.title}>GrowthOS Draft Preview</span></div>
          <div style={previewToolbarStyles.center}>
            <button style={{ ...previewToolbarStyles.btn, ...(previewDevice === 'desktop' ? previewToolbarStyles.activeBtn : {}) }} onClick={() => setPreviewDevice('desktop')}>Desktop</button>
            <button style={{ ...previewToolbarStyles.btn, ...(previewDevice === 'tablet' ? previewToolbarStyles.activeBtn : {}) }} onClick={() => setPreviewDevice('tablet')}>Tablet</button>
            <button style={{ ...previewToolbarStyles.btn, ...(previewDevice === 'mobile' ? previewToolbarStyles.activeBtn : {}) }} onClick={() => setPreviewDevice('mobile')}>Mobile</button>
          </div>
          <div style={previewToolbarStyles.right}><span style={previewToolbarStyles.badge}>&#9889; Preview</span></div>
        </div>
      )}
      <div style={isPreview ? { width: previewDevice === 'mobile' ? '375px' : previewDevice === 'tablet' ? '768px' : '100%', border: previewDevice === 'desktop' ? 'none' : '8px solid #334155', borderRadius: previewDevice === 'desktop' ? '0' : previewDevice === 'mobile' ? '24px' : '12px', boxShadow: previewDevice === 'desktop' ? 'none' : '0 25px 50px -12px rgba(0,0,0,0.25)', margin: previewDevice === 'desktop' ? '0' : '40px auto 20px auto', background: bgColor, minHeight: previewDevice === 'desktop' ? '100vh' : '600px', overflow: 'hidden', transition: 'all 0.3s ease' } : { width: '100%', minHeight: '100vh', background: bgColor }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', minHeight: previewDevice === 'desktop' ? '100vh' : '100%', padding: parsedLayout ? '0' : '60px 20px 40px' }}>
          {parsedLayout ? (
            parsedLayout.sections && parsedLayout.sections.length > 0 ? (
              <div style={{ width: '100%' }}>
                {parsedLayout.sections.map((section: any, sIdx: number) => {
                  if (!section || !section.id) return <div key={`err_sec_${sIdx}`} style={pageStyles.validationError}>⚠️ Invalid Section structure.</div>;

                  // Log section details before rendering
                  const sectionComponentsCount = (section.rows || []).reduce((acc: number, row: any) => {
                    return acc + (row.columns || []).reduce((colAcc: number, col: any) => {
                      return colAcc + (col.components || []).length;
                    }, 0);
                  }, 0);
                  console.log(`[Section Render] ID: ${section.id}, Type: ${section.type}, Components count: ${sectionComponentsCount}`);

                  const visibility = section.settings?.visibility || 'both';
                  if (visibility === 'desktop_only' && isMobileDevice) return null;
                  if (visibility === 'mobile_only' && !isMobileDevice) return null;
                  if (visibility === 'hidden') return null;

                  const secPadding = isMobileDevice && section.settings?.mobile_padding ? section.settings.mobile_padding : (section.settings?.padding || '40px 0');
                  const secMargin = isMobileDevice && section.settings?.mobile_margin ? section.settings.mobile_margin : (section.settings?.margin || '0');
                  const rows = section.rows || [];
                  const anim = section.settings?.section_animation || 'none';
                  const transformStyle = anim === 'slide_up' ? 'translateY(40px)' : anim === 'slide_left' ? 'translateX(-50px)' : anim === 'slide_right' ? 'translateX(50px)' : anim === 'zoom_in' ? 'scale(0.95)' : 'none';

                  return (
                    <SectionErrorBoundary key={section.id} sectionId={section.id} sectionType={section.type}>
                      <section
                        id={section.settings?.anchor_id || section.id}
                        data-anchor={(section.settings?.anchor_id || '').toLowerCase().trim()}
                        data-section-type={(section.type || '').toLowerCase().trim()}
                        data-section-name={(section.name || '').toLowerCase().trim()}
                        className={`animated_section sec-${section.id} ${anim !== 'none' ? 'has_animation' : ''} ${section.settings?.custom_class || ''}`}
                        style={{
                          padding: section.type === 'Navbar' ? '0' : secPadding,
                          margin: secMargin,
                          backgroundColor: section.type === 'Navbar' && section.settings?.transparent ? 'transparent' : (section.settings?.background_color || undefined),
                          position: section.type === 'Navbar' && section.settings?.sticky ? 'sticky' : 'relative',
                          top: section.type === 'Navbar' && section.settings?.sticky ? 0 : undefined,
                          zIndex: section.type === 'Navbar' && section.settings?.sticky ? 1000 : undefined,
                          width: '100%',
                          maxWidth: '100%',
                          borderBottom: section.type === 'Navbar' && section.settings?.show_divider !== false ? '1px solid rgba(0,0,0,0.08)' : undefined,
                          transform: anim !== 'none' ? transformStyle : 'none',
                          opacity: (isPreview || anim === 'none') ? 1 : 0,
                          transition: anim !== 'none' ? 'transform 0.8s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.8s ease' : 'none',
                          overflow: section.settings?.overflow || 'hidden',
                        }}
                      >
                        {section.settings?.video_bg_url && (
                          <video src={section.settings.video_bg_url} autoPlay loop muted playsInline style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0, opacity: section.settings.video_opacity ?? 0.3 }} onError={() => { }} />
                        )}
                        {section.settings?.background_image && (
                          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%', backgroundImage: `url(${section.settings.background_image.startsWith('/static/') ? `${BACKEND_URL}${section.settings.background_image}` : section.settings.background_image})`, backgroundSize: section.settings.background_size || '100% 100%', backgroundRepeat: section.settings.background_repeat || 'no-repeat', backgroundAttachment: section.settings.background_attachment || 'scroll', backgroundPosition: section.settings.background_position || 'center center', zIndex: 0, pointerEvents: 'none' }} />
                        )}
                        {section.settings?.overlay_color && (
                          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: section.settings.overlay_color, opacity: section.settings.overlay_opacity !== undefined ? Number(section.settings.overlay_opacity) : 0.5, background: section.settings.overlay_gradient || undefined, zIndex: 1 }} />
                        )}

                        {section.type === 'Navbar' ? (
                          <NavbarRenderer section={section} isMobileDevice={isMobileDevice} />
                        ) : section.type === 'Footer' ? (
                          <FooterRenderer section={section} isMobileDevice={isMobileDevice} />
                        ) : (
                          <div style={{ position: 'relative', zIndex: 2, width: '100%', maxWidth: section.settings?.container_width === 'full' ? '100%' : (section.settings?.container_width === 'wide' ? '1400px' : '1200px'), margin: '0 auto', padding: section.settings?.container_width === 'full' ? '0' : '0 20px', boxSizing: 'border-box' }} className="funnel-page-content-wrapper">
                            {rows.map((row: any, rIdx: number) => {
                              if (!row || !row.columns) return null;
                              const cols = row.columns;
                              return (
                                <div key={row.id || rIdx} style={{ display: 'flex', flexDirection: isMobileDevice ? 'column' : 'row', gap: row.settings?.gap || '20px', alignItems: row.settings?.align_items || 'stretch', justifyContent: row.settings?.justify_content || 'flex-start', padding: row.settings?.padding || '0', margin: row.settings?.margin || '0', flexWrap: row.settings?.wrap !== false ? 'wrap' : 'nowrap' }}>
                                  {cols.map((col: any, cIdx: number) => {
                                    if (!col) return null;
                                    const colComponents = col.components || [];
                                    const { flex: colFlexVal, width: colWidthVal } = parseColWidthFlex(col.settings?.flex || col.width);
                                    return (
                                      <div key={col.id || cIdx} style={{ flex: isMobileDevice ? '1 1 100%' : colFlexVal, width: isMobileDevice ? '100%' : colWidthVal, minWidth: 0, display: 'flex', flexDirection: 'column', gap: col.settings?.gap || '12px', alignItems: col.settings?.align_items || 'stretch', padding: col.settings?.padding || '0', background: col.settings?.background || 'transparent', borderRadius: col.settings?.border_radius || '0', border: col.settings?.border || 'none', boxSizing: 'border-box' }}>
                                        {colComponents.map((comp: any, compIdx: number) => (
                                          <ComponentErrorBoundary key={comp.id || compIdx} compId={comp.id} compType={comp.type}>
                                            {renderComponent(comp, compIdx, rIdx, sIdx)}
                                          </ComponentErrorBoundary>
                                        ))}
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </section>
                    </SectionErrorBoundary>
                  );
                })}
              </div>
            ) : (
              <div style={pageStyles.emptyStateContainer}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>🚀</div>
                <h3 style={{ margin: '0 0 8px 0', fontFamily: 'Inter, sans-serif', color: '#1e293b' }}>No sections found.</h3>
                <p style={{ margin: 0, fontSize: '14px' }}>Add sections in the builder to see your funnel here.</p>
              </div>
            )
          ) : (
            // ── Legacy step-based layout ──────────────────────────────────────
            <>
              {step.header_text && (
                <h1 style={{ fontSize: isMobileDevice ? '28px' : '40px', fontWeight: 800, color: '#1e293b', marginBottom: '8px', lineHeight: 1.2, textAlign: 'center' }}>{step.header_text}</h1>
              )}
              {step.subheader_text && (
                <p style={{ fontSize: isMobileDevice ? '15px' : '18px', color: '#475569', marginBottom: '28px', lineHeight: 1.5, textAlign: 'center' }}>{step.subheader_text}</p>
              )}
              {step.form_id && (
                <div style={{ marginBottom: '24px' }}>
                  <EmbeddedForm formId={step.form_id} funnelId={funnel.id} stepId={step.id} onSubmitted={handleFormSubmitted} />
                </div>
              )}
              {!step.form_id && step.button_text && (
                <button onClick={() => handleActionClick(step.action_type || 'go_to_next_step', step.action_value)} style={{ width: '100%', padding: '15px 24px', background: 'linear-gradient(135deg, #6366F1, #8B5CF6)', color: '#fff', border: 'none', borderRadius: '12px', fontSize: '17px', fontWeight: 700, cursor: 'pointer', boxShadow: '0 6px 20px rgba(99,102,241,0.4)', transition: 'transform 0.15s, box-shadow 0.15s' }}>
                  {step.button_text}
                </button>
              )}
              {formSubmitted && (
                <div style={{ textAlign: 'center', padding: '20px', background: '#ECFDF5', borderRadius: '12px', margin: '24px 0' }}>
                  <div style={{ fontSize: '32px', marginBottom: '8px' }}>✅</div>
                  <p style={{ color: '#065F46', fontWeight: 600, fontSize: '16px' }}>Action successful!</p>
                </div>
              )}
              {currentStepIndex > 0 && (
                <button onClick={() => { setCurrentStepIndex(prev => prev - 1); setFormSubmitted(false); }} style={{ marginTop: '20px', display: 'block', width: '100%', background: 'none', border: '1.5px solid #E5E7EB', color: '#6B7280', borderRadius: '10px', padding: '10px', fontSize: '14px', cursor: 'pointer' }}>
                  ← Back
                </button>
              )}
            </>
          )}
        </div>
      </div>
      <p style={{ marginTop: '20px', fontSize: '12px', color: 'rgba(0,0,0,0.35)', fontWeight: 500, textAlign: 'center' }}>{step.name}</p>
    </div>
  );
};
