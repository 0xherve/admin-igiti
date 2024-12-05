import Stripe from "stripe";
import { NextResponse } from "next/server";

import { stripe } from "@/lib/stripe";
import prismadb from "@/lib/prismadb";

interface RequestBody {
  products: {
    productId: string;
    quantity: number;
  }[]; 
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://buy.igiti.africa",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Origin",
  proxy: "baseUrlForTheAPI",
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function POST(
  req: Request,
  { params }: { params: { storeId: string } }
) {
  const { products } = (await req.json()) as RequestBody;

  if (!products || products.length === 0) {
    return new NextResponse("Products are required", {
      status: 400,
    });
  }

  const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] = [];

  try {
    for (const productData of products) {
      const product = await prismadb.product.findUnique({
        where: {
          id: productData.productId,
        },
      });

      if (!product) {
        throw new Error(`Product with ID ${productData.productId} not found.`);
      }

      if (product.inStock < productData.quantity) {
        throw new Error(`Not enough stock for ${product.name}.`);
      }

      line_items.push({
        quantity: productData.quantity,
        price_data: {
          currency: "USD",
          product_data: {
            name: product.name,
          },
          unit_amount: product.price.toNumber() * 100,
        },
      });

      // Update stock
      await prismadb.product.update({
        where: { id: productData.productId },
        data: { inStock: product.inStock - productData.quantity },
      });
    }

    if (line_items.length === 0) {
      throw new Error("No products available.");
    }

    const order = await prismadb.order.create({
      data: {
        storeId: params.storeId,
        isPaid: false,
        orderItems: {
          create: products.map((productData) => ({
            product: {
              connect: {
                id: productData.productId,
              },
            },
            quantity: productData.quantity,
          })),
        },
      },
    });

    const session = await stripe.checkout.sessions.create({
      line_items,
      mode: "payment",
      billing_address_collection: "required",
      shipping_address_collection: {
        allowed_countries: ["US", "CA", "RW"], // List of countries for shipping (modify as needed)
      },
      phone_number_collection: {
        enabled: true,
      },
      success_url: `${process.env.FRONTEND_STORE_URL}/success`,
      cancel_url: `${process.env.FRONTEND_STORE_URL}/cart?canceled=1`,
      metadata: {
        orderId: order.id,
      },
    });

    return NextResponse.json(
      { url: session.url },
      { headers: corsHeaders }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message },
      { status: 400 }
    );
  }
}
