<?php
/**
 * Plugin Name: BlueCoreeHR
 * Description: Employee accounts and verified face attendance for WordPress hosting.
 * Version: 0.1.0
 * Requires at least: 6.5
 * Requires PHP: 8.2
 * Author: BlueCoreeHR
 * License: GPL-2.0-or-later
 */
defined('ABSPATH') || exit;
define('BLUECOREE_HR_FILE', __FILE__);
require_once __DIR__ . '/includes/security.php';
require_once __DIR__ . '/includes/database.php';
require_once __DIR__ . '/includes/api.php';
require_once __DIR__ . '/includes/admin.php';
register_activation_hook(__FILE__, 'bluecoree_hr_install');
add_action('rest_api_init', 'bluecoree_hr_routes');
add_action('admin_menu', 'bluecoree_hr_admin_menu');
add_action('admin_post_bluecoree_hr_setup', 'bluecoree_hr_setup');
add_action('template_redirect', function () {
    $post = get_queried_object();
    if ($post instanceof WP_Post && has_shortcode($post->post_content, 'bluecoree_hr')) {
        if (!defined('DONOTCACHEPAGE')) define('DONOTCACHEPAGE', true);
        nocache_headers();
    }
});
add_filter('rest_pre_serve_request', function ($served, $result, $request) {
    if (str_starts_with($request->get_route(), '/bluecoree/v1/')) nocache_headers();
    return $served;
}, 10, 3);
add_shortcode('bluecoree_hr', function () {
    if (!is_user_logged_in()) {
        return '<div class="bluecoree-hr"><h2>BlueCoreeHR employee login</h2><p>Use your employee account to access your profile and attendance.</p><a href="' . esc_url(wp_login_url(get_permalink())) . '">Sign in</a></div>';
    }
    wp_enqueue_style('bluecoree-hr', plugins_url('assets/portal.css', __FILE__), [], '0.1.0');
    wp_enqueue_script('bluecoree-hr', plugins_url('assets/portal.js', __FILE__), [], '0.1.0', true);
    wp_add_inline_script('bluecoree-hr', 'window.BlueCoreeHR=' . wp_json_encode([
        'api' => rest_url('bluecoree/v1/'), 'nonce' => wp_create_nonce('wp_rest'),
        'logout' => wp_logout_url(get_permalink()),
    ]) . ';', 'before');
    return '<section id="bluecoree-hr" class="bluecoree-hr"><h2>BlueCoreeHR</h2><p role="status">Loading your employee portal…</p></section>';
});
