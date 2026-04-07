#!/usr/bin/env python3
"""
Run this script once to generate placeholder icons.
pip install Pillow --break-system-packages
python3 make_icons.py
"""
try:
    from PIL import Image, ImageDraw, ImageFont
    import os

    sizes = [16, 32, 48, 128]
    os.makedirs('icons', exist_ok=True)

    for size in sizes:
        # Create a new image with transparent background
        img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        
        # Calculate radius for a circle background
        margin = max(1, size // 10)
        
        # Create a gradient background
        for y in range(margin, size - margin):
            # Calculate interpolation factor
            factor = (y - margin) / (size - 2 * margin)
            # Blue (#3b82f6) to Purple (#8b5cf6)
            r = int(59 + factor * (139 - 59))
            g = int(130 + factor * (92 - 130))
            b = int(246 + factor * (246 - 246))
            
            # Draw line within the circle bounds (approximate with rounded rectangle for simplicity, or just draw a rounded rectangle)
            # We'll stick to a sleek rounded rectangle
            draw.line([(margin, y), (size - margin, y)], fill=(r, g, b, 255), width=1)
            
        # Draw a clean rounded rectangle for the actual shape, masking out the corners
        mask = Image.new('L', (size, size), 0)
        mask_draw = ImageDraw.Draw(mask)
        mask_draw.rounded_rectangle([margin, margin, size - margin, size - margin], radius=size // 4, fill=255)
        
        # Apply mask
        img.putalpha(mask)
        
        # Draw white stylized 'LH' text in the center
        draw_final = ImageDraw.Draw(img)
        
        # Approximate the letters with simple shapes to ensure it looks good at any size
        # L
        thickness = max(2, size // 12)
        center_x = size // 2
        center_y = size // 2
        
        # Left bar of L
        path_l = [
            (center_x - size // 4, center_y - size // 5),
            (center_x - size // 4 + thickness, center_y + size // 5)
        ]
        draw_final.rectangle(path_l, fill=(255, 255, 255, 255))
        
        # Bottom bar of L
        path_l2 = [
            (center_x - size // 4, center_y + size // 5 - thickness),
            (center_x - size // 12, center_y + size // 5)
        ]
        draw_final.rectangle(path_l2, fill=(255, 255, 255, 255))
        
        # Left bar of H
        path_h1 = [
            (center_x + size // 16, center_y - size // 5),
            (center_x + size // 16 + thickness, center_y + size // 5)
        ]
        draw_final.rectangle(path_h1, fill=(255, 255, 255, 255))
        
        # Right bar of H
        path_h2 = [
            (center_x + size // 4 - thickness, center_y - size // 5),
            (center_x + size // 4, center_y + size // 5)
        ]
        draw_final.rectangle(path_h2, fill=(255, 255, 255, 255))
        
        # Middle bar of H
        path_h3 = [
            (center_x + size // 16, center_y - thickness // 2),
            (center_x + size // 4, center_y + thickness // 2)
        ]
        draw_final.rectangle(path_h3, fill=(255, 255, 255, 255))

        img.save(f'icons/icon{size}.png')
        print(f'Created icons/icon{size}.png')

    print('Icons generated successfully!')

except ImportError:
    print('Pillow not installed. Run: pip install Pillow --break-system-packages')
    print('Or use any PNG image as your icon.')

