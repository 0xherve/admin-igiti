import Stripe from "stripe";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { stripe } from "@/lib/stripe";
import prismadb from "@/lib/prismadb";

export async function POST(req: Request) {
  const body = await req.text();
  const signature = headers().get("Stripe-Signature") as string;

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (error: any) {
    return new NextResponse(`Webhook Error: ${error.message}`, {
      status: 400,
    });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const shippingDetails = session?.shipping_details;

  console.log("Stripe Event Data:", JSON.stringify(event, null, 2));
  console.log("Shipping Details:", session?.shipping_details);
  

  const addressComponents = [
    shippingDetails?.address?.line1,
    shippingDetails?.address?.line2,
    shippingDetails?.address?.city,
    shippingDetails?.address?.state,
    shippingDetails?.address?.postal_code,
    shippingDetails?.address?.country,
  ];

  const addressString = addressComponents.filter((c) => c !== null).join(", ");

  if (event.type === "checkout.session.completed") {
    try {
      const order = await prismadb.order.update({
        where: {
          id: session?.metadata?.orderId,
        },
        data: {
          isPaid: true,
          address: addressString, // Use the shipping address
          phone: shippingDetails?.name || "", // Use the shipping name as phone fallback
        },
        include: {
          orderItems: true,
        },
      });

      const productUpdates = order.orderItems.map(async (orderItem) => {
        const product = await prismadb.product.findUnique({
          where: { id: orderItem.productId },
        });

        if (!product) {
          throw new Error(
            `Product with id ${orderItem.productId} not found.`
          );
        }

        if (product.inStock < orderItem.quantity) {
          throw new Error(
            `Not enough items in stock for product id ${orderItem.productId}.`
          );
        }

        const updatedProduct = await prismadb.product.update({
          where: { id: product.id },
          data: {
            inStock: product.inStock - orderItem.quantity,
          },
        });

        return updatedProduct;
      });

      await Promise.all(productUpdates);
    } catch (error: any) {
      console.error("Error in checkout session:", error);
    }
  }

  return new NextResponse(null, { status: 200 });
}
