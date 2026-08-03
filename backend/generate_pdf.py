import os
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable

def generate_pdf():
    md_path = os.path.join("..", "docs", "client-functionalities-overview.md")
    pdf_path = os.path.join("..", "docs", "client-functionalities-overview.pdf")

    if not os.path.exists(md_path):
        print("Markdown file not found!")
        return

    with open(md_path, "r", encoding="utf-8") as f:
        lines = f.readlines()

    doc = SimpleDocTemplate(
        pdf_path,
        pagesize=letter,
        rightMargin=48,
        leftMargin=48,
        topMargin=48,
        bottomMargin=48
    )

    styles = getSampleStyleSheet()

    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Heading1'],
        fontSize=22,
        leading=26,
        textColor=colors.HexColor('#1E293B'),
        spaceAfter=12
    )

    intro_style = ParagraphStyle(
        'DocIntro',
        parent=styles['Normal'],
        fontSize=10.5,
        leading=15,
        textColor=colors.HexColor('#475569'),
        spaceAfter=14
    )

    h2_style = ParagraphStyle(
        'SectionHeader',
        parent=styles['Heading2'],
        fontSize=13,
        leading=16,
        textColor=colors.HexColor('#2563EB'),
        spaceBefore=12,
        spaceAfter=4
    )

    body_style = ParagraphStyle(
        'SectionBody',
        parent=styles['BodyText'],
        fontSize=9.5,
        leading=14,
        textColor=colors.HexColor('#334155'),
        spaceAfter=8
    )

    code_style = ParagraphStyle(
        'CodeBlock',
        fontName='Courier',
        fontSize=7.5,
        leading=9.5,
        textColor=colors.HexColor('#1E293B'),
        backColor=colors.HexColor('#F1F5F9'),
        borderColor=colors.HexColor('#CBD5E1'),
        borderWidth=1,
        borderPadding=8,
        spaceBefore=8,
        spaceAfter=12,
        borderRadius=4
    )

    story = []
    in_code_block = False
    code_lines = []

    for line in lines:
        line_str = line.rstrip()

        if line_str.startswith("```"):
            if in_code_block:
                block_text = "<br/>".join(code_lines).replace(" ", "&nbsp;")
                story.append(Paragraph(block_text, code_style))
                code_lines = []
                in_code_block = False
            else:
                in_code_block = True
                code_lines = []
            continue

        if in_code_block:
            code_lines.append(line_str)
            continue

        if not line_str.strip():
            continue

        if line_str.startswith("# "):
            story.append(Paragraph(line_str[2:], title_style))
            story.append(HRFlowable(width="100%", thickness=1.5, color=colors.HexColor('#E2E8F0'), spaceAfter=10))
        elif line_str.startswith("### "):
            story.append(Paragraph(line_str[4:], h2_style))
        elif line_str.startswith("---"):
            story.append(Spacer(1, 6))
        else:
            if len(story) <= 2:
                story.append(Paragraph(line_str, intro_style))
            else:
                story.append(Paragraph(line_str, body_style))

    doc.build(story)
    print("PDF successfully generated at:", os.path.abspath(pdf_path))

if __name__ == "__main__":
    generate_pdf()
