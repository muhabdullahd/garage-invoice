import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

// Extract UUID from Garage listing URL
function extractUUID(url: string): string | null {
  const uuidRegex =
    /([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/;
  const match = url.match(uuidRegex);
  return match ? match[1] : null;
}

// Listing attribute from the API
interface ListingAttribute {
  id: string;
  categoryAttributeId: string;
  value: string;
}

// Listing data structure from Garage API
interface ListingData {
  id: string;
  secondaryId: number;
  listingTitle: string;
  listingDescription: string;
  sellingPrice: number;
  appraisedPrice: number | null;
  itemBrand: string | null;
  itemAge: number | null;
  itemLength: number | null;
  itemWidth: number | null;
  itemHeight: number | null;
  itemWeight: number | null;
  vin: string | null;
  deliveryMethod: string | null;
  isPickupAvailable: boolean;
  isAuction: boolean;
  status: string;
  createdAt: string;
  updatedAt: string;
  address: {
    state: string;
  } | null;
  category: {
    name: string;
  } | null;
  ListingAttribute: ListingAttribute[];
  [key: string]: unknown;
}

// Known attribute IDs mapping (based on API response)
const ATTRIBUTE_IDS = {
  CHASSIS: "76720e50-0ae7-4eb7-91a7-5647f81e875c", // Spartan
  MILEAGE: "7d794d55-f1dd-4b5d-90ab-b277e202ceed", // 67053
  PUMP_GPM: "7f168d23-ba9b-4f9e-89e3-dcf6116ba1f7", // 1500
  ENGINE_HOURS: "97200a37-b9fc-49eb-ac7b-a0e42093a77d", // 6146
  BODY_MANUFACTURER: "adacd047-7eb8-4200-a1fc-b31c916728e6", // Marion
  TANK_CAPACITY: "b26315c4-77ca-43f8-bb1f-6b0415ff7ce7", // 500
  VEHICLE_TYPE: "cf994aac-a927-4724-8e06-e2ce203e1b4c", // rescue-pumper
};

// Helper to get attribute value by ID
function getAttributeValue(
  attributes: ListingAttribute[],
  attributeId: string
): string | null {
  const attr = attributes.find((a) => a.categoryAttributeId === attributeId);
  return attr ? attr.value : null;
}

// Fetch listing data from Garage backend
async function fetchListingData(uuid: string): Promise<ListingData> {
  const response = await fetch(
    `https://garage-backend.onrender.com/listings/${uuid}`
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch listing: ${response.statusText}`);
  }

  return response.json();
}

// Sanitize listing title for use as a filename (safe for all OSes)
function sanitizeFilename(title: string, fallback: string): string {
  const sanitized = title
    .replace(/[/\\:*?"<>|]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .trim();
  const safe = sanitized.slice(0, 80) || fallback;
  return safe ? `invoice-${safe}.pdf` : `invoice-${fallback}.pdf`;
}

// Sanitize text to remove characters that WinAnsi encoding can't handle
function sanitizeText(text: string): string {
  return text
    .replace(/\r\n/g, " ")
    .replace(/\n/g, " ")
    .replace(/\r/g, " ")
    .replace(/\t/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Helper to wrap text into lines that fit within a given width
function wrapText(
  text: string,
  font: Awaited<ReturnType<typeof PDFDocument.prototype.embedFont>>,
  fontSize: number,
  maxWidth: number
): string[] {
  const sanitizedText = sanitizeText(text);
  const words = sanitizedText.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const testWidth = font.widthOfTextAtSize(testLine, fontSize);

    if (testWidth > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

// Format currency
function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

// Format number with commas
function formatNumber(num: number): string {
  return new Intl.NumberFormat("en-US").format(num);
}

// Format delivery method
function formatDeliveryMethod(method: string | null): string {
  if (!method) return "N/A";
  const methods: Record<string, string> = {
    FREIGHT_FTL: "Full Truckload Freight",
    FREIGHT_LTL: "Less Than Truckload Freight",
    PICKUP: "Pickup Only",
    DELIVERY: "Delivery Available",
  };
  return methods[method] || method;
}

// Generate PDF invoice from listing data
async function generatePDFInvoice(
  listing: ListingData,
  uuid: string
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage([612, 792]); // Letter size

  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const { width, height } = page.getSize();
  const margin = 50;
  const rightColX = 320;
  let y = height - margin;

  // Minimum y before we need a new page (leave room for content)
  const minYForDescription = margin + 80;
  const minYForPricing = margin + 300; // Pricing section needs ~280px

  const addNewPage = (): void => {
    page = pdfDoc.addPage([612, 792]);
    y = height - margin;
  };

  // Colors
  const black = rgb(0, 0, 0);
  const gray = rgb(0.4, 0.4, 0.4);
  const lightGray = rgb(0.6, 0.6, 0.6);
  const lineColor = rgb(0.85, 0.85, 0.85);

  // Extract attributes
  const attributes = listing.ListingAttribute || [];
  const mileage = getAttributeValue(attributes, ATTRIBUTE_IDS.MILEAGE);
  const engineHours = getAttributeValue(attributes, ATTRIBUTE_IDS.ENGINE_HOURS);
  const pumpGPM = getAttributeValue(attributes, ATTRIBUTE_IDS.PUMP_GPM);
  const tankCapacity = getAttributeValue(attributes, ATTRIBUTE_IDS.TANK_CAPACITY);
  const bodyManufacturer = getAttributeValue(attributes, ATTRIBUTE_IDS.BODY_MANUFACTURER);
  const chassis = getAttributeValue(attributes, ATTRIBUTE_IDS.CHASSIS);
  const vehicleType = getAttributeValue(attributes, ATTRIBUTE_IDS.VEHICLE_TYPE);

  // Helper to draw a label-value pair
  const drawField = (
    label: string,
    value: string,
    x: number,
    yPos: number,
    maxWidth = 200
  ): number => {
    page.drawText(label, {
      x,
      y: yPos,
      size: 9,
      font: helvetica,
      color: lightGray,
    });
    
    const valueLines = wrapText(value, helvetica, 10, maxWidth);
    let currentY = yPos - 12;
    for (const line of valueLines) {
      page.drawText(line, {
        x,
        y: currentY,
        size: 10,
        font: helvetica,
        color: black,
      });
      currentY -= 12;
    }
    return currentY;
  };

  // ===== HEADER =====
  page.drawText("INVOICE", {
    x: margin,
    y,
    size: 28,
    font: helveticaBold,
    color: black,
  });

  // Invoice details (right side)
  const invoiceNumber = `INV-${uuid.substring(0, 8).toUpperCase()}`;
  const invoiceDate = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const listingId = `#${listing.secondaryId || uuid.substring(0, 8)}`;

  page.drawText(`Invoice: ${invoiceNumber}`, {
    x: width - margin - helvetica.widthOfTextAtSize(`Invoice: ${invoiceNumber}`, 10),
    y,
    size: 10,
    font: helvetica,
    color: gray,
  });

  page.drawText(`Date: ${invoiceDate}`, {
    x: width - margin - helvetica.widthOfTextAtSize(`Date: ${invoiceDate}`, 10),
    y: y - 14,
    size: 10,
    font: helvetica,
    color: gray,
  });

  page.drawText(`Listing ID: ${listingId}`, {
    x: width - margin - helvetica.widthOfTextAtSize(`Listing ID: ${listingId}`, 10),
    y: y - 28,
    size: 10,
    font: helvetica,
    color: gray,
  });

  y -= 60;

  // Divider line
  page.drawLine({
    start: { x: margin, y },
    end: { x: width - margin, y },
    thickness: 1,
    color: lineColor,
  });

  y -= 25;

  // ===== SELLER & BUYER INFO =====
  // Seller info (left)
  page.drawText("SELLER", {
    x: margin,
    y,
    size: 9,
    font: helveticaBold,
    color: lightGray,
  });

  page.drawText("Garage Technologies, Inc.", {
    x: margin,
    y: y - 14,
    size: 11,
    font: helveticaBold,
    color: black,
  });

  page.drawText("New York, NY", {
    x: margin,
    y: y - 28,
    size: 10,
    font: helvetica,
    color: gray,
  });

  page.drawText("support@shopgarage.com", {
    x: margin,
    y: y - 42,
    size: 10,
    font: helvetica,
    color: gray,
  });

  y -= 70;

  // Divider
  page.drawLine({
    start: { x: margin, y },
    end: { x: width - margin, y },
    thickness: 1,
    color: lineColor,
  });

  y -= 25;

  // ===== VEHICLE INFORMATION =====
  page.drawText("VEHICLE INFORMATION", {
    x: margin,
    y,
    size: 10,
    font: helveticaBold,
    color: black,
  });

  y -= 20;

  // Vehicle Title
  const title = sanitizeText(listing.listingTitle || "Untitled Listing");
  page.drawText(title, {
    x: margin,
    y,
    size: 14,
    font: helveticaBold,
    color: black,
  });

  y -= 25;

  // Vehicle details in two columns
  const leftColFields: [string, string][] = [
    ["Year", listing.itemAge?.toString() || "N/A"],
    ["Make / Chassis", chassis || listing.itemBrand || "N/A"],
    ["Body Manufacturer", bodyManufacturer || "N/A"],
    ["Vehicle Type", vehicleType ? vehicleType.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "N/A"],
    ["VIN", listing.vin || "N/A"],
    ["Category", listing.category?.name || "N/A"],
  ];

  const rightColFields: [string, string][] = [
    ["Mileage", mileage ? `${formatNumber(parseInt(mileage))} miles` : "N/A"],
    ["Engine Hours", engineHours ? `${formatNumber(parseInt(engineHours))} hrs` : "N/A"],
    ["GVWR", listing.itemWeight ? `${formatNumber(listing.itemWeight)} lbs` : "N/A"],
    ["Dimensions (L x H)", listing.itemLength && listing.itemHeight 
      ? `${listing.itemLength}" x ${listing.itemHeight}"` : "N/A"],
    ["Location", listing.address?.state || "N/A"],
  ];

  let leftY = y;
  let rightY = y;

  for (const [label, value] of leftColFields) {
    leftY = drawField(label, value, margin, leftY, 220) - 8;
  }

  for (const [label, value] of rightColFields) {
    rightY = drawField(label, value, rightColX, rightY, 220) - 8;
  }

  y = Math.min(leftY, rightY) - 10;

  // ===== PUMP & TANK SPECS =====
  if (pumpGPM || tankCapacity) {
    page.drawText("PUMP & TANK SPECIFICATIONS", {
      x: margin,
      y,
      size: 10,
      font: helveticaBold,
      color: black,
    });

    y -= 20;

    if (pumpGPM) {
      y = drawField("Pump Capacity", `${formatNumber(parseInt(pumpGPM))} GPM`, margin, y) - 8;
    }

    if (tankCapacity) {
      y = drawField("Tank Capacity", `${tankCapacity} gallons`, rightColX, y + (pumpGPM ? 32 : 0)) - 8;
    }

    y -= 10;
  }

  // Divider
  page.drawLine({
    start: { x: margin, y },
    end: { x: width - margin, y },
    thickness: 1,
    color: lineColor,
  });

  y -= 25;

  // ===== DESCRIPTION =====
  page.drawText("DESCRIPTION", {
    x: margin,
    y,
    size: 10,
    font: helveticaBold,
    color: black,
  });

  y -= 18;

  // Full description - no truncation; flow to next page when needed
  const description = listing.listingDescription || "No description available";
  const descLines = wrapText(description, helvetica, 10, width - 2 * margin);

  for (const line of descLines) {
    if (y < minYForDescription) {
      addNewPage();
    }
    page.drawText(line, {
      x: margin,
      y,
      size: 10,
      font: helvetica,
      color: gray,
    });
    y -= 14;
  }

  y -= 15;

  // Ensure pricing section has full space - add new page if needed
  if (y < minYForPricing) {
    addNewPage();
  }

  // Divider
  page.drawLine({
    start: { x: margin, y },
    end: { x: width - margin, y },
    thickness: 1,
    color: lineColor,
  });

  y -= 25;

  // ===== PRICING & PAYMENT =====
  page.drawText("PRICING & PAYMENT", {
    x: margin,
    y,
    size: 10,
    font: helveticaBold,
    color: black,
  });

  y -= 25;

  // Price itemization
  const itemPrice = listing.sellingPrice || 0;
  const priceLabel = "Vehicle Sale Price";

  page.drawText(priceLabel, {
    x: margin,
    y,
    size: 11,
    font: helvetica,
    color: black,
  });

  page.drawText(formatCurrency(itemPrice), {
    x: width - margin - helvetica.widthOfTextAtSize(formatCurrency(itemPrice), 11),
    y,
    size: 11,
    font: helvetica,
    color: black,
  });

  y -= 18;

  // Delivery method
  page.drawText("Delivery Method", {
    x: margin,
    y,
    size: 11,
    font: helvetica,
    color: black,
  });

  const deliveryText = formatDeliveryMethod(listing.deliveryMethod);
  page.drawText(deliveryText, {
    x: width - margin - helvetica.widthOfTextAtSize(deliveryText, 11),
    y,
    size: 11,
    font: helvetica,
    color: black,
  });

  y -= 18;

  if (listing.isPickupAvailable) {
    page.drawText("Pickup Available", {
      x: margin,
      y,
      size: 11,
      font: helvetica,
      color: black,
    });

    page.drawText("Yes", {
      x: width - margin - helvetica.widthOfTextAtSize("Yes", 11),
      y,
      size: 11,
      font: helvetica,
      color: black,
    });

    y -= 18;
  }

  y -= 10;

  // Total line
  page.drawLine({
    start: { x: width - 250, y },
    end: { x: width - margin, y },
    thickness: 1,
    color: black,
  });

  y -= 20;

  // Total
  page.drawText("TOTAL DUE", {
    x: margin,
    y,
    size: 12,
    font: helveticaBold,
    color: black,
  });

  page.drawText(formatCurrency(itemPrice), {
    x: width - margin - helveticaBold.widthOfTextAtSize(formatCurrency(itemPrice), 14),
    y,
    size: 14,
    font: helveticaBold,
    color: black,
  });

  y -= 30;

  // Payment terms
  page.drawText("Payment Terms:", {
    x: margin,
    y,
    size: 9,
    font: helveticaBold,
    color: lightGray,
  });

  page.drawText("Payment due upon delivery. Contact seller for financing options.", {
    x: margin,
    y: y - 12,
    size: 9,
    font: helvetica,
    color: gray,
  });

  y -= 35;

  // Warranty notes
  page.drawText("Warranty:", {
    x: margin,
    y,
    size: 8,
    font: helveticaBold,
    color: lightGray,
  });

  page.drawText("Vehicle sold as-is unless otherwise noted. Inspect before purchase.", {
    x: margin + 45,
    y,
    size: 8,
    font: helvetica,
    color: gray,
  });

  y -= 25;

  // Divider line (short, centered - not full width to avoid underline look)
  const footerLineWidth = 200;
  page.drawLine({
    start: { x: width / 2 - footerLineWidth / 2, y },
    end: { x: width / 2 + footerLineWidth / 2, y },
    thickness: 0.5,
    color: lineColor,
  });

  y -= 18;

  // Generated by
  const generatedText = "Generated by Garage Invoice Generator | www.shopgarage.com";
  page.drawText(generatedText, {
    x: width / 2 - helvetica.widthOfTextAtSize(generatedText, 8) / 2,
    y,
    size: 8,
    font: helvetica,
    color: lightGray,
  });

  return pdfDoc.save();
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const url = searchParams.get("url");

    if (!url) {
      return NextResponse.json(
        { error: "Missing 'url' query parameter" },
        { status: 400 }
      );
    }

    const uuid = extractUUID(url);
    if (!uuid) {
      return NextResponse.json(
        { error: "Invalid URL: Could not extract listing UUID" },
        { status: 400 }
      );
    }

    const listingData = await fetchListingData(uuid);
    const pdfBytes = await generatePDFInvoice(listingData, uuid);
    const filename = sanitizeFilename(
      listingData.listingTitle,
      uuid.substring(0, 8)
    );

    return new Response(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": pdfBytes.length.toString(),
      },
    });
  } catch (error) {
    console.error("Error generating invoice:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to generate invoice",
      },
      { status: 500 }
    );
  }
}
